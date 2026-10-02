/**
 * A scraper upgrade re-reads sessions and replaces their rows under new ids.
 *
 * The cloud copy was uploaded under the old ids, so sending only the new rows
 * would leave both versions there. The per-session reconcile (`keepIds`) is
 * what removes the old ones; this runs a real scan, a real upgrade re-read and
 * real uploads to show the cloud ends equal to the index.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashParts } from "@xtctx/handoff/hash";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";
import { saveCredentials } from "@xtctx/sync/client";
import { setOptedIn } from "@xtctx/sync/consent";
import { runDiffSync } from "@xtctx/sync/diff-sync";
import { fakeCloud, sandbox } from "./helpers";

const records = [
  { type: "user", message: { role: "user", content: "fix the build" }, timestamp: "2026-02-24T10:00:00Z" },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run build" } }],
    },
    timestamp: "2026-02-24T10:00:01Z",
  },
  {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "build ok" }] },
    timestamp: "2026-02-24T10:00:02Z",
  },
  { type: "assistant", message: { role: "assistant", content: "Done." }, timestamp: "2026-02-24T10:00:03Z" },
];

describe("cloud copy across a scraper-version re-read", () => {
  let box: ReturnType<typeof sandbox>;
  let cloud: ReturnType<typeof fakeCloud>;
  let projects = "";
  let state = "";
  let dbPath = "";

  beforeEach(async () => {
    box = sandbox();
    cloud = fakeCloud();
    vi.stubGlobal("fetch", cloud.fetch);
    projects = join(box.root, "claude-projects");
    state = join(box.project, ".xtctx", "state");
    dbPath = join(state, "xtctx.db");
    mkdirSync(join(projects, "proj"), { recursive: true });
    mkdirSync(state, { recursive: true });
    await writeFile(join(projects, "proj", "sess.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await saveCredentials({
      token: "tok",
      user: { id: "github:1", username: "u" },
      deviceId: "dev",
      deviceName: "device-abc123",
      syncUrl: "https://sync.test",
    });
    await setOptedIn(box.project, true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    box.cleanup();
  });

  async function scan(): Promise<void> {
    const index = new SqliteHandoffIndex(dbPath, box.project, [
      { tool: "claude-code", scraper: new ClaudeCodeScraper(projects, state) },
    ]);
    try {
      await index.listRecentSessions(5);
    } finally {
      await index.close();
    }
  }

  const local = () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db
        .prepare("SELECT id, role, content FROM messages WHERE session_ref = 'claude-code:sess' ORDER BY message_index, id")
        .all() as Array<{ id: string; role: string; content: string }>;
    } finally {
      db.close();
    }
  };
  const stored = () => cloud.stored("sess");

  /** Rewrite the rows into what scraper version 1 wrote, and forget the version. */
  async function downgrade(): Promise<void> {
    const db = new Database(dbPath);
    try {
      db.prepare("DELETE FROM messages WHERE content LIKE 'ran Bash:%'").run();
      const rows = db
        .prepare("SELECT id, timestamp, content, message_index FROM messages WHERE role = 'tool'")
        .all() as Array<{ id: string; timestamp: string; content: string; message_index: number }>;
      for (const row of rows) {
        const oldId = hashParts(["claude-code", "sess", row.timestamp, "user", String(row.message_index), row.content]);
        db.prepare("UPDATE messages SET id = ?, role = 'user' WHERE id = ?").run(oldId, row.id);
      }
    } finally {
      db.close();
    }
    const statePath = join(state, "claude-code-state.json");
    const saved = JSON.parse(await readFile(statePath, "utf-8")) as Record<string, unknown>;
    delete saved.scraperVersion;
    await writeFile(statePath, JSON.stringify(saved));
  }

  it("ends with the cloud holding exactly the re-read rows, none of the replaced ones", async () => {
    await scan();
    await downgrade();
    await runDiffSync({ projectDir: box.project });

    // The cloud holds the old shape: three rows, the tool result filed as the user.
    const before = local();
    expect(before.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
    expect(stored().map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort());

    await scan(); // the upgrade re-read: rows replaced under new ids
    const after = local();
    expect(after.map((m) => m.role)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(after.filter((m) => !before.some((b) => b.id === m.id)).length).toBeGreaterThan(0);

    await runDiffSync({ projectDir: box.project });

    expect(stored().map((m) => m.id).sort()).toEqual(after.map((m) => m.id).sort());
    expect(stored().map((m) => m.content).sort()).toEqual(after.map((m) => m.content).sort());
    const sent = cloud.uploads().flatMap((u) => u.body.sessions.flatMap((s) => s.messages)) as Array<{ role?: string }>;
    expect(sent.some((m) => m.role === "tool")).toBe(true);
  });
});
