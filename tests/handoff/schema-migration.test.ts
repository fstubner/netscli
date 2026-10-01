/**
 * An index from an older schema is upgraded in place, not rebuilt.
 *
 * Rebuilding reads the transcripts still on disk, and the index is the only
 * copy of every session whose transcript has since been cleaned up — Claude
 * Code deletes them after 30 days by default. So each schema bump used to drop
 * those sessions from retrieval: first by deleting the file, then (#388/#389)
 * by setting it aside where nothing read it.
 *
 * Each case builds an index the way this build writes one, rewinds it to the
 * shape an older version wrote (taken from `git log -G"SCHEMA_VERSION ="`),
 * deletes one session's transcript, and opens it again.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { normalizeRootForCompare } from "@xtctx/handoff/queries";
import { AgingStoreScraper } from "./aging-store.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xtctx-migrate-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function open(store: AgingStoreScraper): SqliteHandoffIndex {
  return new SqliteHandoffIndex(join(dir, "xtctx.db"), dir, [{ tool: store.tool, scraper: store }], {
    refreshBudgetMs: 60_000,
  });
}

/** Rewind a current index to the shape `version` wrote. */
function rewindTo(version: number): void {
  const db = new Database(join(dir, "xtctx.db"));
  // Before version 3 the root was stored as given, not canonicalised.
  db.prepare("UPDATE sessions SET project_root = ?").run(dir);
  if (version <= 1) {
    db.exec("ALTER TABLE sessions DROP COLUMN git_branch");
    db.exec("ALTER TABLE sessions DROP COLUMN git_commit");
  }
  if (version === 0) {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts
        USING fts5(session_ref UNINDEXED, tool UNINDEXED, role UNINDEXED, timestamp UNINDEXED, content);
      DROP TABLE retrieval_unit_vectors;
      CREATE TABLE retrieval_unit_vectors (
        unit_id TEXT PRIMARY KEY REFERENCES retrieval_units(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
  db.pragma(`user_version = ${version}`);
  db.close();
}

describe("opening an index from an older schema", () => {
  for (const version of [0, 1, 2]) {
    it(`migrates version ${version} in place and keeps sessions whose transcripts are gone`, async () => {
      const store = new AgingStoreScraper(dir)
        .write("kept", ["the session still on disk"], { gitBranch: "main" })
        .write("aged", ["the only copy of the migration plan is in the index"], {
          gitBranch: "feature",
        });
      const first = open(store);
      await first.listRecentSessions(10);
      await first.close();

      rewindTo(version);
      store.age("aged");

      const index = open(store);
      const refs = (await index.listRecentSessions(10)).map((session) => session.session_ref);
      const detail = await index.getSessionDetail("codex:aged", 0, 10);
      const found = await index.searchSessions("migration plan", 5, undefined, "keyword");
      await index.close();

      expect(refs.sort()).toEqual(["codex:aged", "codex:kept"]);
      expect(detail.map((message) => message.content)).toEqual([
        "the only copy of the migration plan is in the index",
      ]);
      expect(found.map((session) => session.session_ref)).toEqual(["codex:aged"]);
      // Not set aside: there is nothing to set aside when the file upgrades.
      expect((await readdir(dir)).filter((name) => name.includes("set-aside"))).toEqual([]);

      const db = new Database(join(dir, "xtctx.db"), { readonly: true });
      expect(db.pragma("user_version", { simple: true })).toBe(3);
      // Rows written raw are stored the way version 3 stores them.
      const roots = db.prepare("SELECT DISTINCT project_root FROM sessions").pluck().all();
      expect(roots).toEqual([normalizeRootForCompare(realpathSync(dir))]);
      // The re-read the migration forces fills what the old shape lacked for
      // the session still on disk; the aged one keeps what it had.
      const branches = db
        .prepare("SELECT session_ref, git_branch FROM sessions ORDER BY session_ref")
        .all();
      db.close();
      expect(branches).toEqual([
        { session_ref: "codex:aged", git_branch: version <= 1 ? null : "feature" },
        { session_ref: "codex:kept", git_branch: "main" },
      ]);
    });
  }

  it("re-reads the transcripts still on disk after migrating, rather than trusting the cursor", async () => {
    const store = new AgingStoreScraper(dir).write("kept", ["hello", "world"]);
    const first = open(store);
    await first.listRecentSessions(10);
    await first.close();
    rewindTo(2);

    // The cursor says "hello" has been read (it trails the last message by the
    // scan's one-second overlap, so "world" comes round again either way);
    // only a cleared cursor reads "hello" a second time.
    const before = store.yielded;
    const index = open(store);
    await index.listRecentSessions(10);
    await index.close();

    expect(store.yielded - before).toBe(2);
    const db = new Database(join(dir, "xtctx.db"), { readonly: true });
    const migrated = db.prepare("SELECT value FROM settings WHERE key = 'schema_migrated_from'").get();
    db.close();
    // Consumed once the cursors are cleared, so the next open does not re-read again.
    expect(migrated).toBeUndefined();
  });
});
