/**
 * Every agent session starts its own xtctx server, and every server scans the
 * same transcript stores into the same per-project index. Two of them reading
 * one growing session lost its newest messages permanently.
 *
 * The mechanism, measured with three servers over a 10,000-message corpus
 * while sessions grew: 70–74 rows lost in every run, still missing after two
 * later rescans. A scan that reads a session from the top prunes the rows it
 * did not produce (see `pruneRereadSessions`). A server whose read predates an
 * append therefore deleted the rows a second server had just inserted for that
 * append — and the second server's cursor, already saved at the end of the
 * file, meant nothing would ever read those lines again.
 *
 * Each test here reproduces one layer of that deterministically, with a gate
 * holding the first scan between its read and its prune while the file grows
 * and a second scanner runs.
 */
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { scanTool } from "@xtctx/handoff/scan";
import { openDatabase, prepareStatements } from "@xtctx/handoff/schema";
import { normalizeRootForCompare } from "@xtctx/handoff/queries";
import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

const SESSION = "growing-session";
const REF = `claude-code:${SESSION}`;

/**
 * Hands the inner scraper's chunks through, then holds the scan at the point
 * between "every file read and its cursor saved" and "prune", until released.
 */
class GatedScraper implements ConversationScraper {
  readonly tool = "claude-code";
  private releaseGate: () => void = () => {};
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });
  private markReached: () => void = () => {};
  readonly reached = new Promise<void>((resolve) => {
    this.markReached = resolve;
  });

  constructor(private readonly inner: ClaudeCodeScraper) {}

  release(): void {
    this.releaseGate();
  }
  async detect(): Promise<boolean> {
    return this.inner.detect();
  }
  getStorePaths(): string[] {
    return this.inner.getStorePaths();
  }
  async *scrape(): AsyncIterable<ConversationChunk> {
    for await (const chunk of this.inner.scrape()) yield chunk;
    this.markReached();
    await this.gate;
  }
  async *fullSync(): AsyncIterable<ConversationChunk> {
    yield* this.inner.fullSync();
  }
  async getLastScrapedPosition(): Promise<ScraperState> {
    return this.inner.getLastScrapedPosition();
  }
  async saveScrapedPosition(state: ScraperState): Promise<void> {
    return this.inner.saveScrapedPosition(state);
  }
  useIndexProbe(probe: Parameters<NonNullable<ConversationScraper["useIndexProbe"]>>[0]): void {
    this.inner.useIndexProbe?.(probe);
  }
}

describe("concurrent scans of a growing session", () => {
  let root = "";
  let projectsDir = "";
  let storeDir = "";
  let stateDir = "";
  let dbPath = "";
  let transcript = "";
  const open: SqliteHandoffIndex[] = [];

  const record = (n: number): string =>
    JSON.stringify({
      type: n % 2 === 0 ? "user" : "assistant",
      timestamp: new Date(Date.parse("2026-05-10T10:00:00.000Z") + n * 1000).toISOString(),
      cwd: root,
      sessionId: SESSION,
      message: { role: n % 2 === 0 ? "user" : "assistant", content: `turn number ${n}` },
    }) + "\n";

  const scraper = (): ClaudeCodeScraper =>
    new ClaudeCodeScraper(projectsDir, stateDir, root, storeDir);

  function index(s: ConversationScraper, budget = 0): SqliteHandoffIndex {
    const created = new SqliteHandoffIndex(dbPath, root, [{ tool: "claude-code", scraper: s }], {
      refreshBudgetMs: budget,
    });
    open.push(created);
    return created;
  }

  async function scanOnce(s: ConversationScraper): Promise<void> {
    const once = index(s);
    await once.listRecentSessions(5);
    await once.whenScanSettled();
    await once.close();
  }

  function storedTurns(): string[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      return (
        db
          .prepare("SELECT content FROM messages WHERE session_ref = ? ORDER BY message_index")
          .all(REF) as Array<{ content: string }>
      ).map((row) => row.content);
    } finally {
      db.close();
    }
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "xtctx-concurrent-")));
    projectsDir = join(root, "projects");
    storeDir = join(projectsDir, "store");
    stateDir = join(root, "state");
    dbPath = join(stateDir, "xtctx.db");
    transcript = join(storeDir, `${SESSION}.jsonl`);
    await mkdir(storeDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(transcript, [0, 1, 2].map(record).join(""), "utf-8");

    // Indexed once, then the cursor file removed: the state a scan killed
    // before its scraper finished leaves behind, since cursors are saved only
    // at the end of a scrape. The next read of this session starts at the top.
    await scanOnce(scraper());
    await rm(join(stateDir, "claude-code-state.json"), { force: true });
  });

  afterEach(async () => {
    for (const created of open.splice(0)) await created.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("keeps rows another server inserted while this one was reading", async () => {
    const gated = new GatedScraper(scraper());
    const first = index(gated);
    const second = index(scraper());

    await first.listRecentSessions(5);
    await gated.reached;

    // The session grows after the first server read it.
    await appendFile(transcript, [3, 4].map(record).join(""), "utf-8");

    // A second server scans. Without coordination it finishes in
    // milliseconds; with it, it waits for the first.
    await second.listRecentSessions(5);
    await Promise.race([second.whenScanSettled(), new Promise((r) => setTimeout(r, 1_000))]);

    gated.release();
    await first.whenScanSettled();
    await second.whenScanSettled();
    await first.close();
    await second.close();

    // A later session's rescan is what proves the loss permanent: the rows
    // are not merely missing, nothing will ever bring them back.
    await scanOnce(scraper());

    expect(storedTurns()).toEqual([0, 1, 2, 3, 4].map((n) => `turn number ${n}`));
  });

  it("does not prune rows inserted after its own scan began, even without the lease", async () => {
    // Defence in depth: two scanners overlapping anyway — a lease taken over
    // from a holder that stalled past its expiry, say — must not lose rows.
    // Driven below the index, so no lease is involved at all.
    const scopedRoot = normalizeRootForCompare(root);
    const dbFirst = openDatabase(dbPath);
    const dbSecond = openDatabase(dbPath);
    try {
      const gated = new GatedScraper(scraper());
      const firstScan = scanTool(gated, {
        db: dbFirst,
        stmts: prepareStatements(dbFirst),
        scopedRoot,
      });
      await gated.reached;

      await appendFile(transcript, [3, 4].map(record).join(""), "utf-8");
      await scanTool(scraper(), { db: dbSecond, stmts: prepareStatements(dbSecond), scopedRoot });

      gated.release();
      await firstScan;
    } finally {
      dbFirst.close();
      dbSecond.close();
    }

    expect(storedTurns()).toEqual([0, 1, 2, 3, 4].map((n) => `turn number ${n}`));
  });
});

describe("a cursor the index no longer backs", () => {
  let root = "";
  let projectsDir = "";
  let storeDir = "";
  let stateDir = "";
  let dbPath = "";

  const record = (n: number): string =>
    JSON.stringify({
      type: "user",
      timestamp: new Date(Date.parse("2026-05-10T10:00:00.000Z") + n * 1000).toISOString(),
      cwd: root,
      message: { role: "user", content: `turn number ${n}` },
    }) + "\n";

  async function scan(): Promise<string[]> {
    const created = new SqliteHandoffIndex(
      dbPath,
      root,
      [{ tool: "claude-code", scraper: new ClaudeCodeScraper(projectsDir, stateDir, root, storeDir) }],
      { refreshBudgetMs: 0 },
    );
    try {
      await created.listRecentSessions(5);
      await created.whenScanSettled();
      return (await created.getSessionDetail(REF, 0, 50)).map((m) => m.content);
    } finally {
      await created.close();
    }
  }

  function deleteTail(): void {
    const db = new Database(dbPath);
    try {
      db.prepare("DELETE FROM messages WHERE session_ref = ? AND message_index >= 3").run(REF);
    } finally {
      db.close();
    }
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "xtctx-backed-")));
    projectsDir = join(root, "projects");
    storeDir = join(projectsDir, "store");
    stateDir = join(root, "state");
    dbPath = join(stateDir, "xtctx.db");
    await mkdir(storeDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(storeDir, `${SESSION}.jsonl`), [0, 1, 2, 3, 4].map(record).join(""), "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("re-reads a file whose cursor points past rows the index lost", async () => {
    expect(await scan()).toHaveLength(5);

    // The shape the concurrent prune left behind on real indexes: the cursor
    // at the end of the file, the tail of the session gone from the index.
    deleteTail();

    expect(await scan()).toEqual([0, 1, 2, 3, 4].map((n) => `turn number ${n}`));
  });

  it("re-reads once when the cursor predates the check, repairing an index already damaged", async () => {
    expect(await scan()).toHaveLength(5);
    deleteTail();

    // A cursor as an earlier version wrote it, with nothing to check it by.
    const statePath = join(stateDir, "claude-code-state.json");
    const state = JSON.parse(await readFile(statePath, "utf-8")) as {
      files: Record<string, Record<string, unknown>>;
    };
    for (const cursor of Object.values(state.files)) delete cursor.lastEmitted;
    await writeFile(statePath, JSON.stringify(state), "utf-8");

    expect(await scan()).toEqual([0, 1, 2, 3, 4].map((n) => `turn number ${n}`));
  });
});
