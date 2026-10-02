/**
 * A scan runs on the thread that answers tool calls, over synchronous SQLite.
 *
 * Measured before these tests existed, on a 15,000-message corpus: a request
 * needing no index at all (`tools/list`) waited up to 3.8 seconds behind the
 * scan; a server told to shut down mid-scan sat out its whole two-second grace
 * window and was then killed by its own timer, so it never closed the index;
 * and with several servers open, write-ahead logs of up to 30MB stayed behind
 * after every server had exited.
 */
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScanLease } from "@xtctx/handoff/scan-lease";
import { openDatabase } from "@xtctx/handoff/schema";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

/** Turns are long in real transcripts, and building windows costs with their text. */
const WORDS = Array.from({ length: 300 }, (_, i) => `word${i % 97} parser fallback budget`).join(" ");

function chunk(session: number, index: number): ConversationChunk {
  return {
    tool: "codex",
    sessionId: `s${session}`,
    timestamp: new Date(Date.parse("2026-05-10T10:00:00.000Z") + index * 1000),
    role: index % 2 === 0 ? "user" : "assistant",
    content: `session ${session} message ${index} ${WORDS}`,
    metadata: { messageIndex: index, tokenEstimate: 1, layer: 0 },
  };
}

/** Yields without ever touching I/O, so nothing in it lets the event loop turn. */
class InMemoryScraper implements ConversationScraper {
  readonly tool = "codex";
  saves = 0;
  constructor(private readonly chunks: () => Iterable<ConversationChunk>) {}
  async detect(): Promise<boolean> {
    return true;
  }
  getStorePaths(): string[] {
    return ["fixture://codex"];
  }
  async *scrape(): AsyncIterable<ConversationChunk> {
    yield* this.chunks();
  }
  async *fullSync(): AsyncIterable<ConversationChunk> {
    yield* this.chunks();
  }
  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }
  async saveScrapedPosition(): Promise<void> {
    this.saves += 1;
  }
}

describe("a scan shares its thread", () => {
  let dir = "";
  let dbPath = "";
  let index: SqliteHandoffIndex | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-shutdown-"));
    dbPath = join(dir, "xtctx.db");
  });

  afterEach(async () => {
    await index?.close().catch(() => {});
    index = undefined;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("lets the event loop turn while it works", async () => {
    const scraper = new InMemoryScraper(function* () {
      for (let s = 0; s < 40; s++) for (let i = 0; i < 40; i++) yield chunk(s, i);
    });
    index = new SqliteHandoffIndex(dbPath, dir, [{ tool: "codex", scraper }], {
      refreshBudgetMs: 0,
    });

    let last = Date.now();
    let longestGap = 0;
    const ticker = setInterval(() => {
      longestGap = Math.max(longestGap, Date.now() - last);
      last = Date.now();
    }, 5);
    const started = Date.now();
    let took = 0;
    try {
      await index.listRecentSessions(5);
      await index.whenScanSettled();
      took = Date.now() - started;
      // A block that ends the scan is only seen by the ticker's next run.
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      clearInterval(ticker);
    }

    // Relative, so a loaded machine slowing everything down does not fail it:
    // before, one stretch held the thread for over nine-tenths of the scan
    // (1,515ms of 1,621ms on this corpus); the longest now is one session's
    // windows, a small fraction of it.
    // The floor only checks the corpus gave the ratio something to measure.
    // It was 1,000ms and failed at 994ms on a fast CI runner; the ratio below
    // is the assertion that matters.
    expect(took).toBeGreaterThan(500);
    expect(longestGap).toBeLessThan(took / 4);
  });

  it("stops at its next checkpoint when the index closes, and claims nothing it did not finish", async () => {
    const scraper = new InMemoryScraper(function* () {
      for (let i = 0; ; i++) yield chunk(i % 50, Math.floor(i / 50));
    });
    index = new SqliteHandoffIndex(dbPath, dir, [{ tool: "codex", scraper }], {
      refreshBudgetMs: 0,
    });
    await index.listRecentSessions(5);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const started = Date.now();
    await index.close();
    index = undefined;

    expect(Date.now() - started).toBeLessThan(1_000);
    // Nothing recorded as read past what was written...
    expect(scraper.saves).toBe(0);
    // ...what was written stays written, and the lease is free for the next server.
    const db = openDatabase(dbPath);
    try {
      expect((db.prepare("SELECT COUNT(*) AS c FROM messages").get() as { c: number }).c).toBeGreaterThan(0);
      expect(new ScanLease(db).tryAcquire()).toBe(true);
    } finally {
      db.close();
    }
  });

  it("empties the write-ahead log on close while another server still has the index open", async () => {
    const scraper = new InMemoryScraper(function* () {
      for (let s = 0; s < 20; s++) for (let i = 0; i < 40; i++) yield chunk(s, i);
    });
    index = new SqliteHandoffIndex(dbPath, dir, [{ tool: "codex", scraper }], {
      refreshBudgetMs: 0,
    });
    await index.listRecentSessions(5);
    await index.whenScanSettled();

    // Another server's connection. SQLite only cleans the log up by itself
    // when the last connection closes, and with one server per agent session
    // that is rarely the one that wrote it.
    const other = new Database(dbPath);
    try {
      other.prepare("SELECT COUNT(*) FROM sessions").get();
      await index.close();
      index = undefined;

      const wal = `${dbPath}-wal`;
      expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
    } finally {
      other.close();
    }
  });
});
