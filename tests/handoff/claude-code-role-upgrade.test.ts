/**
 * Upgrading must correct the roles already in the index, in place.
 *
 * Roles were wrong at ingestion (tool results indexed as "user"). Fixing the
 * scraper alone fixes nothing already indexed: the resume cursor sits past
 * every finished session, so those rows stay mislabelled until a transcript
 * happens to grow. A rebuild is not an option — it would drop sessions whose
 * transcripts have aged out, and their rows are the only copy.
 *
 * The index here is built, rewritten into the shape the old scraper produced,
 * its scraper state stripped of the version, and then scanned again.
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashParts } from "@xtctx/handoff/hash";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";

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

describe("claude-code role correction on upgrade", () => {
  let root = "";
  let projects = "";
  let state = "";
  let dbPath = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xtctx-role-upgrade-"));
    projects = join(root, "projects");
    state = join(root, "state");
    dbPath = join(root, "xtctx.db");
    await mkdir(join(projects, "proj"), { recursive: true });
    await mkdir(state, { recursive: true });
    await writeFile(
      join(projects, "proj", "sess.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function scan(): Promise<Array<{ role: string; content: string }>> {
    const index = new SqliteHandoffIndex(dbPath, root, [
      { tool: "claude-code", scraper: new ClaudeCodeScraper(projects, state) },
    ]);
    try {
      await index.listRecentSessions(5);
      return (await index.getSessionDetail("claude-code:sess", 0, 100)).map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } finally {
      await index.close();
    }
  }

  /** Rewrite the stored rows into what the old scraper wrote. */
  async function downgrade(): Promise<void> {
    const db = new Database(dbPath);
    try {
      // tool_use-only turns were dropped, and a tool result was a "user" row
      // under an id that hashes that role.
      db.prepare("DELETE FROM messages WHERE content LIKE 'ran Bash:%'").run();
      const rows = db
        .prepare("SELECT id, timestamp, content, message_index FROM messages WHERE role = 'tool'")
        .all() as Array<{ id: string; timestamp: string; content: string; message_index: number }>;
      for (const row of rows) {
        const oldId = hashParts([
          "claude-code",
          "sess",
          row.timestamp,
          "user",
          String(row.message_index),
          row.content,
        ]);
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

  it("relabels already-indexed tool output without duplicating rows, and only once", async () => {
    await scan();
    await downgrade();

    // The precondition the fix has to overcome: the index really holds the old shape.
    const db = new Database(dbPath, { readonly: true });
    const before = db.prepare("SELECT role FROM messages ORDER BY message_index").all() as Array<{
      role: string;
    }>;
    db.close();
    expect(before.map((r) => r.role)).toEqual(["user", "user", "assistant"]);

    const after = await scan();

    expect(after).toEqual([
      { role: "user", content: "fix the build" },
      { role: "tool", content: "ran Bash: npm run build" },
      { role: "tool", content: "build ok" },
      { role: "assistant", content: "Done." },
    ]);

    // Run once: the stored version now matches, so the next scan reads nothing again.
    const saved = JSON.parse(await readFile(join(state, "claude-code-state.json"), "utf-8")) as {
      scraperVersion?: number;
    };
    expect(saved.scraperVersion).toBeGreaterThanOrEqual(2);
    expect(await scan()).toEqual(after);
  });

  it("leaves rows for sessions whose transcript is gone as they were", async () => {
    await scan();
    await downgrade();
    await rm(join(projects, "proj", "sess.jsonl"));

    const after = await scan();

    expect(after.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
  });
});
