/**
 * A corrupt index is set aside and rebuilt; the sessions only it held come back.
 *
 * Rebuilding reads the transcripts still on disk. Sessions whose transcripts
 * have been cleaned up — Claude Code deletes them after 30 days by default —
 * exist only in the old file, and setting that file aside (#388/#389) kept
 * them on disk where nothing read them: retrieval lost them all the same.
 *
 * The damage here is real damage to real pages, chosen so the file still
 * opens and fails on its first read — the case set-aside exists for — while
 * the session and message pages stay readable.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { AgingStoreScraper } from "./aging-store.js";

const PAGE = 4096;
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xtctx-carry-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function open(store: AgingStoreScraper): SqliteHandoffIndex {
  return new SqliteHandoffIndex(join(dir, "xtctx.db"), dir, [{ tool: store.tool, scraper: store }], {
    refreshBudgetMs: 60_000,
  });
}

/** Leaf pages of the index's file belonging to tables and indexes named like `pattern`. */
function leafPages(pattern: string): number[] {
  const db = new Database(join(dir, "xtctx.db"), { readonly: true });
  try {
    return db
      .prepare("SELECT pageno FROM dbstat WHERE name LIKE ? AND pagetype = 'leaf' ORDER BY pageno")
      .pluck()
      .all(pattern) as number[];
  } finally {
    db.close();
  }
}

async function damagePages(pages: number[]): Promise<void> {
  const path = join(dir, "xtctx.db");
  const bytes = await readFile(path);
  for (const page of pages) {
    bytes.fill(0xa5, (page - 1) * PAGE, page * PAGE);
  }
  await writeFile(path, bytes);
}

function setAsideFiles(names: string[]): string[] {
  return names.filter((name) => name.startsWith("xtctx.db.set-aside-") && !/-(wal|shm)$/.test(name));
}

describe("a corrupt index set aside and rebuilt", () => {
  it("carries forward the sessions whose transcripts are gone", async () => {
    const store = new AgingStoreScraper(dir)
      .write("kept", ["the session still on disk"])
      .write("aged", ["the only copy of the rollback plan is in the index", "and its reply"]);
    const first = open(store);
    await first.listRecentSessions(10);
    await first.close();

    // The settings table (and its key index, which a lookup reads instead) is
    // read on every open, so damaging it makes the open fail as corrupt;
    // sessions and messages are untouched. Not the vector table: an open with
    // semantic search off never reads it.
    await damagePages(leafPages("%settings%"));
    store.age("aged");

    const index = open(store);
    const refs = (await index.listRecentSessions(10)).map((session) => session.session_ref);
    const detail = await index.getSessionDetail("codex:aged", 0, 10);
    const found = await index.searchSessions("rollback plan", 5, undefined, "keyword");
    const status = await index.getStatus();
    await index.close();

    expect(setAsideFiles(await readdir(dir))).toHaveLength(1);
    expect(refs.sort()).toEqual(["codex:aged", "codex:kept"]);
    expect(detail.map((message) => message.content)).toEqual([
      "the only copy of the rollback plan is in the index",
      "and its reply",
    ]);
    // Windows are rebuilt for it, so search reaches it, not only detail.
    expect(found.map((session) => session.session_ref)).toEqual(["codex:aged"]);
    expect(status.sessions).toBe(2);
    expect(status.messages).toBe(3);
  });

  it("does it once per set-aside file", async () => {
    const store = new AgingStoreScraper(dir).write("aged", ["only here"]);
    const first = open(store);
    await first.listRecentSessions(10);
    await first.close();
    await damagePages(leafPages("%settings%"));
    store.age("aged");

    const second = open(store);
    await second.listRecentSessions(10);
    await second.close();

    // Something removed afterwards is not brought back by the next scan: the
    // file has been read, and is recorded as read.
    const db = new Database(join(dir, "xtctx.db"));
    db.prepare("DELETE FROM sessions WHERE session_ref = 'codex:aged'").run();
    const recorded = db
      .prepare("SELECT value FROM settings WHERE key LIKE 'carried_forward:%'")
      .pluck()
      .all() as string[];
    db.close();
    expect(recorded).toHaveLength(1);
    expect(JSON.parse(recorded[0] as string)).toMatchObject({ copied: 1, unreadable: 0 });

    const third = open(store);
    const refs = (await third.listRecentSessions(10)).map((session) => session.session_ref);
    await third.close();
    expect(refs).toEqual([]);
  });

  it("copies what a damaged set-aside file still yields, and counts what it does not", async () => {
    const store = new AgingStoreScraper(dir);
    // About a page per session, so damage to one message page costs one
    // session rather than all of them.
    for (let i = 0; i < 12; i += 1) {
      store.write(`s${String(i).padStart(2, "0")}`, [`session ${i} `.repeat(300)], {
        at: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      });
    }
    const first = open(store);
    await first.listRecentSessions(20);
    await first.close();

    const messagePages = leafPages("messages");
    expect(messagePages.length).toBeGreaterThan(3);
    await damagePages([...leafPages("%settings%"), messagePages[1] as number]);
    for (let i = 0; i < 12; i += 1) {
      store.age(`s${String(i).padStart(2, "0")}`);
    }

    const index = open(store);
    const sessions = await index.listRecentSessions(20);
    await index.close();

    const db = new Database(join(dir, "xtctx.db"), { readonly: true });
    const recorded = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key LIKE 'carried_forward:%'").pluck().get() as string,
    ) as { copied: number; unreadable: number };
    db.close();

    expect(recorded.unreadable).toBeGreaterThan(0);
    expect(recorded.copied).toBeGreaterThan(0);
    expect(recorded.copied + recorded.unreadable).toBe(12);
    expect(sessions).toHaveLength(recorded.copied);
  });

  it("records a set-aside file nothing can be read from, and still builds the new index", async () => {
    await writeFile(join(dir, "xtctx.db"), "this is not a sqlite database", "utf-8");

    const index = open(new AgingStoreScraper(dir).write("fresh", ["hi"]));
    const refs = (await index.listRecentSessions(10)).map((session) => session.session_ref);
    await index.close();

    expect(refs).toEqual(["codex:fresh"]);
    const db = new Database(join(dir, "xtctx.db"), { readonly: true });
    const recorded = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key LIKE 'carried_forward:%'").pluck().get() as string,
    ) as { copied: number; error?: string };
    db.close();
    expect(recorded.copied).toBe(0);
    expect(recorded.error).toMatch(/not a database/i);
  });
});
