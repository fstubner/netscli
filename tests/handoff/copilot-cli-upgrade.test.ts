/**
 * Upgrading must correct what the Copilot CLI scraper already indexed, in place.
 *
 * The old scraper indexed the CLI's system prompt and subagent output as turns
 * and dropped tool executions. Fixing the scraper alone fixes nothing already
 * indexed: the resume cursor sits past every finished session, so those rows
 * stay as they were until a transcript happens to grow. A rebuild is not an
 * option — it would drop sessions whose transcripts have aged out.
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
import { CopilotCliScraper } from "@xtctx/scrapers/copilot-cli";

const events = [
  { type: "session.start", timestamp: "2026-02-24T10:00:00Z", data: { context: { cwd: "H:/p" } } },
  { type: "system.message", timestamp: "2026-02-24T10:00:01Z", data: { role: "system", content: "you are copilot" } },
  { type: "user.message", timestamp: "2026-02-24T10:00:02Z", data: { content: "list the files" } },
  {
    type: "tool.execution_start",
    timestamp: "2026-02-24T10:00:03Z",
    data: { toolCallId: "tc1", toolName: "bash", arguments: { command: "ls" } },
  },
  {
    type: "assistant.message",
    timestamp: "2026-02-24T10:00:04Z",
    data: { content: "subagent finding", parentToolCallId: "tc1" },
  },
  { type: "assistant.message", timestamp: "2026-02-24T10:00:05Z", data: { content: "Here are the files." } },
];

/** What the old scraper wrote for the events above: no tool line, a system turn, a subagent "assistant". */
const OLD_ROWS = [
  { index: 0, role: "system", content: "you are copilot", at: "2026-02-24T10:00:01.000Z" },
  { index: 1, role: "user", content: "list the files", at: "2026-02-24T10:00:02.000Z" },
  { index: 2, role: "assistant", content: "subagent finding", at: "2026-02-24T10:00:04.000Z" },
  { index: 3, role: "assistant", content: "Here are the files.", at: "2026-02-24T10:00:05.000Z" },
];

describe("copilot-cli correction on upgrade", () => {
  let root = "";
  let sessions = "";
  let state = "";
  let dbPath = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xtctx-cc-upgrade-"));
    sessions = join(root, "sessions");
    state = join(root, "state");
    dbPath = join(root, "xtctx.db");
    await mkdir(join(sessions, "sess"), { recursive: true });
    await mkdir(state, { recursive: true });
    await writeFile(
      join(sessions, "sess", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function scan(): Promise<Array<{ role: string; content: string }>> {
    const index = new SqliteHandoffIndex(dbPath, root, [
      { tool: "copilot-cli", scraper: new CopilotCliScraper(sessions, state) },
    ]);
    try {
      await index.listRecentSessions(5);
      return (await index.getSessionDetail("copilot-cli:sess", 0, 100)).map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } finally {
      await index.close();
    }
  }

  /** Replace the stored rows with what the old scraper wrote. */
  async function downgrade(): Promise<void> {
    const db = new Database(dbPath);
    try {
      db.prepare("DELETE FROM messages WHERE session_ref = 'copilot-cli:sess'").run();
      const insert = db.prepare(
        `INSERT INTO messages (id, session_ref, tool, source_session_id, timestamp, role, content,
           message_index, content_hash, metadata_json, source_pointer, indexed_at)
         VALUES (?, 'copilot-cli:sess', 'copilot-cli', 'sess', ?, ?, ?, ?, ?, '{}', NULL, ?)`,
      );
      for (const row of OLD_ROWS) {
        insert.run(
          hashParts(["copilot-cli", "sess", row.at, row.role, String(row.index), row.content]),
          row.at,
          row.role,
          row.content,
          row.index,
          hashParts([row.content]),
          new Date().toISOString(),
        );
      }
    } finally {
      db.close();
    }
    const statePath = join(state, "copilot-cli-state.json");
    const saved = JSON.parse(await readFile(statePath, "utf-8")) as Record<string, unknown>;
    delete saved.scraperVersion;
    await writeFile(statePath, JSON.stringify(saved));
  }

  it("replaces already-indexed rows without duplicating them, and only once", async () => {
    await scan();
    await downgrade();

    // The precondition the fix has to overcome: the index really holds the old shape.
    const db = new Database(dbPath, { readonly: true });
    const before = db
      .prepare("SELECT role FROM messages WHERE session_ref = 'copilot-cli:sess' ORDER BY message_index")
      .all() as Array<{ role: string }>;
    db.close();
    expect(before.map((r) => r.role)).toEqual(["system", "user", "assistant", "assistant"]);

    const after = await scan();

    expect(after).toEqual([
      { role: "user", content: "list the files" },
      { role: "tool", content: "ran bash: ls" },
      { role: "tool", content: "subagent finding" },
      { role: "assistant", content: "Here are the files." },
    ]);

    // Run once: the stored version now matches, so the next scan resumes past the file.
    const saved = JSON.parse(await readFile(join(state, "copilot-cli-state.json"), "utf-8")) as {
      scraperVersion?: number;
    };
    expect(saved.scraperVersion).toBeGreaterThanOrEqual(2);
    expect(await scan()).toEqual(after);
  });

  it("leaves rows for sessions whose transcript is gone as they were", async () => {
    await scan();
    await downgrade();
    await rm(join(sessions, "sess", "events.jsonl"));

    const after = await scan();

    expect(after.map((m) => m.role)).toEqual(["system", "user", "assistant", "assistant"]);
  });
});
