/**
 * A message still streaming when it was read must be read again once it
 * finishes, and must replace what was stored rather than sit beside it.
 *
 * The cursor is one timestamp across every opencode session, and a message was
 * only read when its creation time was past it. With two sessions open, the
 * busier one moves the cursor beyond a message the other is still writing, and
 * that message was never visited again: the index kept its first partial text
 * for good. When a read did reach it, the final text arrived under a new id —
 * ids hash the content — beside the partial row already stored.
 *
 * A session is now read whole whenever one of its rows (the session's, a
 * message's, or a message's own recorded time) is newer than the cursor, which
 * is also what lets the index drop the rows a re-read no longer produces.
 */
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";

const HOUR = 3_600_000;
const T = Date.now() - 12 * HOUR;

let dir = "";
let ocPath = "";
let stateDir = "";
let indexPath = "";

function writeStore(): void {
  const db = new Database(ocPath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  const session = db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)");
  const message = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  const part = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)");

  // The slow session: one message, written while it was still being streamed.
  session.run("ses-slow", "/work/proj", "slow", T, T);
  message.run("m-slow", "ses-slow", T, T, JSON.stringify({ role: "assistant", time: { created: T } }));
  part.run("p-slow", "m-slow", "ses-slow", T, T, JSON.stringify({ type: "text", text: "the answer is" }));

  // The busy session: newer, so it carries the cursor past the slow message.
  session.run("ses-busy", "/work/proj", "busy", T, T + HOUR);
  message.run(
    "m-busy",
    "ses-busy",
    T + HOUR,
    T + HOUR,
    JSON.stringify({ role: "user", time: { created: T + HOUR } }),
  );
  part.run("p-busy", "m-busy", "ses-busy", T + HOUR, T + HOUR, JSON.stringify({ type: "text", text: "unrelated" }));
  db.close();
}

/** What opencode does when the message finishes: edit the rows, bump time_updated. */
function finishSlowMessage(): void {
  const db = new Database(ocPath);
  const done = T + 2 * HOUR;
  db.prepare("UPDATE part SET data = ?, time_updated = ? WHERE id = 'p-slow'").run(
    JSON.stringify({ type: "text", text: "the answer is 42" }),
    done,
  );
  db.prepare("UPDATE message SET time_updated = ? WHERE id = 'm-slow'").run(done);
  db.prepare("UPDATE session SET time_updated = ? WHERE id = 'ses-slow'").run(done);
  db.close();
}

async function scan(session: string): Promise<string[]> {
  const index = new SqliteHandoffIndex(indexPath, dir, [
    { tool: "opencode", scraper: new OpenCodeScraper(ocPath, stateDir) },
  ]);
  try {
    await index.listRecentSessions(5);
    return (await index.getSessionDetail(`opencode:${session}`, 0, 100)).map((m) => m.content);
  } finally {
    await index.close();
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xtctx-oc-reread-"));
  stateDir = join(dir, "state");
  ocPath = join(dir, "opencode.db");
  indexPath = join(dir, "xtctx.db");
  writeStore();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("opencode message that changes after it was first read", () => {
  it("replaces the partial text with the final text, leaving one row", async () => {
    expect(await scan("ses-slow")).toEqual(["the answer is"]);

    finishSlowMessage();

    expect(await scan("ses-slow")).toEqual(["the answer is 42"]);
  });

  it("leaves a session nothing has touched alone", async () => {
    expect(await scan("ses-busy")).toEqual(["unrelated"]);

    finishSlowMessage();

    expect(await scan("ses-busy")).toEqual(["unrelated"]);
  });
});
