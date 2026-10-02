/**
 * Upgrading must correct what the Cursor and opencode scrapers already
 * indexed, in place.
 *
 * Both now emit rows the old versions did not — tool-call lines, and for
 * Cursor a subagent's prompt under a different role. Changing the scraper
 * alone changes nothing already stored: the cursor sits past every
 * conversation that was read, so those rows stay as they were until the
 * conversation next changes. A rebuild is not an option, since it would drop
 * conversations that have left the store, and their rows are the only copy.
 *
 * Each index here is built with the current scraper, rewritten into the shape
 * the old one produced with its scraper state stripped of the version, and then
 * scanned again. The scan has to be the only thing that brings the rows back —
 * a second session carries the cursor past the first so nothing else would.
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashParts } from "@xtctx/handoff/hash";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { CursorScraper } from "@xtctx/scrapers/cursor";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";
import type { ConversationScraper } from "@xtctx/types/scraper";

let root = "";
let state = "";
let dbPath = "";

async function scan(
  tool: string,
  scraper: ConversationScraper,
  sessionId: string,
): Promise<Array<{ role: string; content: string }>> {
  const index = new SqliteHandoffIndex(dbPath, root, [{ tool, scraper }]);
  try {
    await index.listRecentSessions(5);
    return (await index.getSessionDetail(`${tool}:${sessionId}`, 0, 100)).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  } finally {
    await index.close();
  }
}

async function dropVersion(tool: string): Promise<void> {
  const statePath = join(state, `${tool}-state.json`);
  const saved = JSON.parse(await readFile(statePath, "utf-8")) as Record<string, unknown>;
  delete saved.scraperVersion;
  await writeFile(statePath, JSON.stringify(saved));
}

async function storedVersion(tool: string): Promise<number | undefined> {
  const saved = JSON.parse(await readFile(join(state, `${tool}-state.json`), "utf-8")) as {
    scraperVersion?: number;
  };
  return saved.scraperVersion;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xtctx-cursor-oc-upgrade-"));
  state = join(root, "state");
  dbPath = join(root, "xtctx.db");
  await mkdir(state, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("cursor re-reads once on upgrade", () => {
  const T0 = new Date("2026-02-24T10:00:00Z").getTime();
  let workspaceDir = "";

  function bubble(createdAtMs: number, fields: Record<string, unknown>): string {
    return JSON.stringify({ createdAt: new Date(createdAtMs).toISOString(), ...fields });
  }

  beforeEach(() => {
    workspaceDir = join(root, "workspaceStorage", "ws1");
  });

  async function seedStore(): Promise<void> {
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(join(root, "globalStorage"), { recursive: true });

    const ws = new Database(join(workspaceDir, "state.vscdb"));
    ws.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    ws.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify({ allComposers: [{ composerId: "c-sub" }, { composerId: "c-busy" }] }),
    );
    ws.close();

    const db = new Database(join(root, "globalStorage", "state.vscdb"));
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec(
      "CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, isSubagent INTEGER, subagentTypeName TEXT)",
    );
    db.prepare("INSERT INTO composerHeaders VALUES (?, ?, ?, ?)").run("c-sub", "ws1", 1, "explore");
    db.prepare("INSERT INTO composerHeaders VALUES (?, ?, ?, ?)").run("c-busy", "ws1", 0, null);

    const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    const composer = (id: string, bubbleIds: Array<[string, number]>) =>
      JSON.stringify({
        composerId: id,
        fullConversationHeadersOnly: bubbleIds.map(([bubbleId, type]) => ({ bubbleId, type })),
        unifiedMode: "agent",
      });

    // The subagent: its parent's prompt, one tool call, one reply.
    put.run("composerData:c-sub", composer("c-sub", [["s1", 1], ["s2", 2], ["s3", 2]]));
    put.run("bubbleId:c-sub:s1", bubble(T0, { type: 1, text: "explore the repo and report" }));
    put.run(
      "bubbleId:c-sub:s2",
      bubble(T0 + 1000, {
        type: 2,
        text: "",
        toolFormerData: { name: "read_file_v2", params: JSON.stringify({ targetFile: "README.md" }) },
      }),
    );
    put.run("bubbleId:c-sub:s3", bubble(T0 + 2000, { type: 2, text: "found it" }));

    // A later conversation, which carries the cursor past the subagent's.
    put.run("composerData:c-busy", composer("c-busy", [["b1", 1]]));
    put.run("bubbleId:c-busy:b1", bubble(T0 + 3_600_000, { type: 1, text: "something later" }));
    db.close();
  }

  /** Rewrite the stored rows into what the old scraper wrote. */
  function downgrade(): void {
    const db = new Database(dbPath);
    try {
      // Tool bubbles were dropped, and a subagent's prompt was a "user" row
      // under an id that hashes that role.
      db.prepare("DELETE FROM messages WHERE content LIKE 'used %'").run();
      const prompt = db
        .prepare(
          "SELECT id, timestamp, content, message_index FROM messages WHERE session_ref = 'cursor:c-sub' AND role = 'tool'",
        )
        .get() as { id: string; timestamp: string; content: string; message_index: number };
      const oldId = hashParts([
        "cursor",
        "c-sub",
        prompt.timestamp,
        "user",
        String(prompt.message_index),
        prompt.content,
      ]);
      db.prepare("UPDATE messages SET id = ?, role = 'user' WHERE id = ?").run(oldId, prompt.id);
    } finally {
      db.close();
    }
  }

  const make = () => new CursorScraper(workspaceDir, state);

  it("restores tool lines and the subagent prompt's role without duplicating rows, and only once", async () => {
    await seedStore();
    await scan("cursor", make(), "c-sub");
    await dropVersion("cursor");
    downgrade();

    // The precondition the fix has to overcome: the index holds the old shape.
    const before = new Database(dbPath, { readonly: true });
    const roles = (
      before.prepare("SELECT role FROM messages WHERE session_ref = 'cursor:c-sub' ORDER BY message_index").all() as Array<{ role: string }>
    ).map((row) => row.role);
    before.close();
    expect(roles).toEqual(["user", "assistant"]);

    const after = await scan("cursor", make(), "c-sub");

    expect(after).toEqual([
      { role: "tool", content: "explore the repo and report" },
      { role: "tool", content: "used read_file_v2: README.md" },
      { role: "assistant", content: "found it" },
    ]);

    // Run once: the stored version now matches, so the next scan reads nothing again.
    expect(await storedVersion("cursor")).toBeGreaterThanOrEqual(2);
    expect(await scan("cursor", make(), "c-sub")).toEqual(after);
  });

  it("leaves a conversation that has left the store as it was", async () => {
    await seedStore();
    await scan("cursor", make(), "c-sub");
    await dropVersion("cursor");
    downgrade();

    const db = new Database(join(root, "globalStorage", "state.vscdb"));
    db.prepare("DELETE FROM cursorDiskKV WHERE key LIKE '%c-sub%'").run();
    db.close();

    const after = await scan("cursor", make(), "c-sub");

    expect(after.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("opencode re-reads once on upgrade", () => {
  const HOUR = 3_600_000;
  const T = Date.now() - 12 * HOUR;
  let ocPath = "";

  function seedStore(): void {
    const db = new Database(ocPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    const session = db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)");
    const message = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
    const part = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)");

    session.run("ses-tools", "/work/proj", "tools", T, T);
    message.run("m1", "ses-tools", T, T, JSON.stringify({ role: "assistant", time: { created: T } }));
    part.run("p1", "m1", "ses-tools", T, T, JSON.stringify({ type: "text", text: "looking" }));
    part.run(
      "p2",
      "m1",
      "ses-tools",
      T + 1,
      T + 1,
      JSON.stringify({ type: "tool", tool: "read", state: { status: "completed", title: "src/a.ts" } }),
    );

    // Newer, so it carries the cursor past the first session.
    session.run("ses-busy", "/work/proj", "busy", T, T + HOUR);
    message.run("m2", "ses-busy", T + HOUR, T + HOUR, JSON.stringify({ role: "user", time: { created: T + HOUR } }));
    part.run("p3", "m2", "ses-busy", T + HOUR, T + HOUR, JSON.stringify({ type: "text", text: "later" }));
    db.close();
  }

  beforeEach(() => {
    ocPath = join(root, "opencode.db");
  });

  const make = () => new OpenCodeScraper(ocPath, state);

  it("restores tool lines already skipped, without duplicating rows, and only once", async () => {
    seedStore();
    await scan("opencode", make(), "ses-tools");
    await dropVersion("opencode");

    // The old scraper never wrote the tool line.
    const db = new Database(dbPath);
    db.prepare("DELETE FROM messages WHERE content LIKE 'used %'").run();
    db.close();
    expect((await scanRows()).map((m) => m.role)).toEqual(["assistant"]);

    const after = await scan("opencode", make(), "ses-tools");

    expect(after).toEqual([
      { role: "assistant", content: "looking" },
      { role: "tool", content: "used read: src/a.ts" },
    ]);

    expect(await storedVersion("opencode")).toBeGreaterThanOrEqual(2);
    expect(await scan("opencode", make(), "ses-tools")).toEqual(after);
  });

  /** What the index holds, read straight from its database without scanning. */
  async function scanRows(): Promise<Array<{ role: string }>> {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db
        .prepare("SELECT role FROM messages WHERE session_ref = 'opencode:ses-tools' ORDER BY message_index, timestamp")
        .all() as Array<{ role: string }>;
    } finally {
      db.close();
    }
  }
});
