/**
 * Retrieval units are what search reads. They are rebuilt only for the
 * sessions a scan touched, at the end, after every scraper has finished —
 * while each scraper advances its own cursor as soon as it finishes, and the
 * CLI exits two seconds after stdin closes on every client disconnect.
 *
 * A scan that dies in that gap leaves messages committed and the cursor past
 * them, so nothing re-reads them and the units are never rebuilt. The messages
 * stay reachable through `xtctx_session_detail` and invisible to both keyword
 * and semantic search — a silent hole, because the session looks fine.
 *
 * `reconcileSessionRollups` already repairs `message_count` for exactly this
 * gap. There was no counterpart for units, and the maintainer's own index
 * carried 1,343 and 356 uncovered messages in its two live sessions.
 */
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { scanTool } from "@xtctx/handoff/scan";
import { normalizeRootForCompare } from "@xtctx/handoff/queries";
import { openDatabase, prepareStatements } from "@xtctx/handoff/schema";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

/** Cursor genuinely advances, so a later scan re-reads nothing. */
class CursoredScraper implements ConversationScraper {
  readonly tool = "codex";
  private drained = false;
  constructor(private readonly chunks: ConversationChunk[]) {}
  async detect(): Promise<boolean> { return true; }
  getStorePaths(): string[] { return ["fixture://codex"]; }
  async *scrape(): AsyncIterable<ConversationChunk> {
    if (this.drained) return;
    yield* this.chunks;
  }
  async *fullSync(): AsyncIterable<ConversationChunk> { yield* this.scrape(); }
  async getLastScrapedPosition(): Promise<ScraperState> { return { lastTimestamp: new Date(0) }; }
  async saveScrapedPosition(_s: ScraperState): Promise<void> { this.drained = true; }
}

function chunk(i: number): ConversationChunk {
  return {
    tool: "codex",
    sessionId: "s1",
    timestamp: new Date(Date.parse("2026-05-10T10:00:00.000Z") + i * 1000),
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message number ${i} about the parser fallback`,
    metadata: { messageIndex: i, tokenEstimate: 1, layer: 0 },
  };
}

/** The drift signal: windows that do not reach the session's last message. */
function coverageGap(dbPath: string, sessionRef: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT (SELECT MAX(message_index) FROM messages WHERE session_ref = ?) AS maxMsg,
             COALESCE((SELECT MAX(message_end_index) FROM retrieval_units WHERE session_ref = ?), -1) AS maxCovered
    `).get(sessionRef, sessionRef) as { maxMsg: number; maxCovered: number };
    return row.maxMsg - row.maxCovered;
  } finally {
    db.close();
  }
}

describe("retrieval unit recovery after an interrupted scan", () => {
  let tempDir = "";
  let dbPath = "";
  const REF = "codex:s1";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-units-"));
    dbPath = join(tempDir, "xtctx.db");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rebuilds units a previous scan never got to, without re-reading the store", async () => {
    const chunks = Array.from({ length: 24 }, (_, i) => chunk(i));
    const scraper = new CursoredScraper(chunks);

    const first = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await first.listRecentSessions(5);
    await first.whenScanSettled?.();
    await first.close();

    expect(coverageGap(dbPath, REF)).toBe(0);

    // Simulate the interruption: messages committed, cursor advanced, units
    // for the tail never built. Deleting the trailing windows is the faithful
    // row state a killed scan leaves behind.
    const raw = new Database(dbPath);
    raw.prepare("DELETE FROM retrieval_units WHERE session_ref = ? AND message_end_index > 7").run(REF);
    raw.prepare("DELETE FROM retrieval_units_fts WHERE session_ref = ?").run(REF);
    raw.close();

    expect(coverageGap(dbPath, REF)).toBeGreaterThan(0);

    // A fresh index over the same drained store: recovery cannot come from
    // re-ingesting, only from reconciling what is already stored.
    const second = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await second.listRecentSessions(5);
    await second.whenScanSettled?.();
    await second.close();

    expect(coverageGap(dbPath, REF)).toBe(0);
  });

  it("makes the recovered messages findable, not merely present", async () => {
    // The point of a retrieval unit is search. Coverage arithmetic alone would
    // pass if units were rebuilt empty.
    const chunks = Array.from({ length: 24 }, (_, i) => chunk(i));
    chunks[20] = {
      ...chunks[20],
      content: "the distinctive marmalade heuristic lives here",
    };
    const scraper = new CursoredScraper(chunks);

    const first = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await first.listRecentSessions(5);
    await first.whenScanSettled?.();
    await first.close();

    const raw = new Database(dbPath);
    raw.prepare("DELETE FROM retrieval_units WHERE session_ref = ? AND message_end_index > 7").run(REF);
    raw.prepare("DELETE FROM retrieval_units_fts WHERE session_ref = ?").run(REF);
    raw.close();

    const second = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await second.listRecentSessions(5);
    await second.whenScanSettled?.();
    const hits = await second.searchSessions("marmalade", 5);
    await second.close();

    // Assert on the matched window, not on the preview: previews truncate at
    // 240 characters and stop well before message 20's text, so a substring
    // check would fail on a working fix.
    const covering = hits.flatMap((hit) => hit.matches ?? []).filter(
      (m) => m.message_start_index <= 20 && m.message_end_index >= 20,
    );
    // That the window was genuinely missing beforehand is what the coverage
    // test above establishes; probing for it here cannot work, because
    // opening an index triggers the very reconciliation under test.
    expect(covering.length).toBeGreaterThan(0);
  });

  it("does not rewrite units for a session that is already covered", async () => {
    // Reconciliation must be a no-op where nothing drifted, or every scan
    // rebuilds the whole corpus and the cost grows with history.
    const scraper = new CursoredScraper(Array.from({ length: 12 }, (_, i) => chunk(i)));

    const first = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await first.listRecentSessions(5);
    await first.whenScanSettled?.();
    await first.close();

    const raw = new Database(dbPath);
    const before = raw.prepare("SELECT id, updated_at FROM retrieval_units WHERE session_ref = ? ORDER BY id").all(REF);
    raw.close();

    const second = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await second.listRecentSessions(5);
    await second.whenScanSettled?.();
    await second.close();

    const rawAfter = new Database(dbPath);
    const after = rawAfter.prepare("SELECT id, updated_at FROM retrieval_units WHERE session_ref = ? ORDER BY id").all(REF);
    rawAfter.close();

    expect(after).toEqual(before);
  });

  /**
   * The repair is scoped to this project, like every read is.
   *
   * One database can hold another project's sessions — the index elsewhere
   * already contemplates a copied `.xtctx/` or a root that was renamed — and
   * the reconcile query was the one place that selected sessions without
   * asking whose they were. Rebuilding windows for a foreign session spends
   * the scan's repair budget, and the embedding that follows it, on rows no
   * read here can ever return: every search filters on `project_root`.
   *
   * The repair's first pass is bounded by time, so foreign rows do not merely
   * waste work — they spend the budget this project's own gap needed.
   */
  it("leaves another project's sessions alone", async () => {
    const chunks = Array.from({ length: 24 }, (_, i) => chunk(i));

    const first = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new CursoredScraper(chunks) },
    ]);
    await first.listRecentSessions(5);
    await first.whenScanSettled?.();
    await first.close();

    // A session belonging to somewhere else entirely, with messages and no
    // windows — exactly the shape the reconcile query looks for.
    const foreignRef = "codex:foreign";
    const raw = new Database(dbPath);
    try {
      const at = "2026-05-10T10:00:00.000Z";
      raw
        .prepare(
          `INSERT INTO sessions
             (session_ref, tool, source_session_id, project_root, started_at,
              last_activity_at, message_count, updated_at)
           VALUES (?, 'codex', 'foreign', ?, ?, ?, ?, ?)`,
        )
        .run(foreignRef, join(tempDir, "some-other-project"), at, at, 4, at);
      for (let i = 0; i < 4; i++) {
        raw
          .prepare(
            `INSERT INTO messages
               (id, session_ref, tool, source_session_id, timestamp, role, content,
                message_index, content_hash, metadata_json, indexed_at)
             VALUES (?, ?, 'codex', 'foreign', ?, 'user', ?, ?, ?, '{}', ?)`,
          )
          .run(`${foreignRef}#${i}`, foreignRef, at, `foreign message ${i}`, i, `hash${i}`, at);
      }
      // And damage this project's session, so there is real work to prefer.
      raw.prepare("DELETE FROM retrieval_units WHERE session_ref = ? AND message_end_index > 7").run(REF);
    } finally {
      raw.close();
    }

    const second = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new CursoredScraper(chunks) },
    ]);
    await second.listRecentSessions(5);
    await second.whenScanSettled?.();
    await second.close();

    const check = new Database(dbPath, { readonly: true });
    let foreignUnits = -1;
    try {
      foreignUnits = (
        check.prepare("SELECT COUNT(*) AS c FROM retrieval_units WHERE session_ref = ?").get(foreignRef) as {
          c: number;
        }
      ).c;
    } finally {
      check.close();
    }

    // This project's gap closed...
    expect(coverageGap(dbPath, REF)).toBe(0);
    // ...and the foreign session was never touched.
    expect(foreignUnits).toBe(0);
  });

  /**
   * The repair used to stop at four sessions a scan, so a first scan killed
   * between saving its cursor and building windows left most of the index
   * unsearchable for many sessions afterwards: measured over a 100-session
   * corpus, 96 of 2,400 windows came back per later session. Bounded by time
   * now, and finished after the scan rather than abandoned.
   */
  it("rebuilds windows for every session a killed scan left without them", async () => {
    const sessions = Array.from({ length: 10 }, (_, s) =>
      Array.from({ length: 24 }, (_, i) => ({ ...chunk(i), sessionId: `s${s}` })),
    );
    const scraper = new CursoredScraper(sessions.flat());

    const first = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await first.listRecentSessions(5);
    await first.whenScanSettled?.();
    await first.close();

    const raw = new Database(dbPath);
    raw.exec("DELETE FROM retrieval_units; DELETE FROM retrieval_units_fts;");
    raw.close();

    const second = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await second.listRecentSessions(5);
    await second.whenScanSettled?.();
    await second.close();

    for (let s = 0; s < 10; s++) {
      expect(coverageGap(dbPath, `codex:s${s}`)).toBe(0);
    }
  });

  /**
   * Coverage arithmetic cannot see a turn whose text changed at a position the
   * windows already reach. A re-read that replaced it, cut short before the
   * windows were rebuilt, left search answering from the old text forever.
   */
  it("rebuilds windows for a session whose rows changed under them", async () => {
    const original = Array.from({ length: 24 }, (_, i) => chunk(i));
    original[5] = { ...original[5], content: "the marmalade heuristic" };
    const scraper = new CursoredScraper(original);
    const first = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await first.listRecentSessions(5);
    await first.whenScanSettled?.();
    await first.close();

    // A re-read that replaces turn 5, written by the scan and then cut off:
    // rows changed, windows never rebuilt.
    const changed = [...original];
    changed[5] = { ...changed[5], content: "the quince heuristic" };
    const db = openDatabase(dbPath);
    try {
      await scanTool(new CursoredScraper(changed), {
        db,
        stmts: prepareStatements(db),
        scopedRoot: normalizeRootForCompare(realpathSync(tempDir)),
      });
    } finally {
      db.close();
    }

    const second = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);
    await second.listRecentSessions(5);
    await second.whenScanSettled?.();
    const hits = await second.searchSessions("quince", 5, undefined, "keyword");
    await second.close();

    expect(hits.map((hit) => hit.session_ref)).toEqual([REF]);
  });
});
