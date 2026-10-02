/**
 * One scanner per project at a time, across the servers every agent session
 * starts. See `src/handoff/scan-lease.ts` for why.
 *
 * The holder tests pin the lease's own rules; the index tests pin what a
 * server does around it — waits, scans after the holder, skips a scan someone
 * else already did for it, and is not blocked by a holder that died.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseHandle } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SCAN_COMPLETED_FROM_KEY,
  SCAN_LEASE_KEY,
  SCAN_LEASE_RENEW_MS,
  ScanLease,
} from "@xtctx/handoff/scan-lease";
import { openDatabase, setSetting } from "@xtctx/handoff/schema";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

class CountingScraper implements ConversationScraper {
  readonly tool = "codex";
  scrapes = 0;
  async detect(): Promise<boolean> {
    return true;
  }
  getStorePaths(): string[] {
    return ["fixture://codex"];
  }
  async *scrape(): AsyncIterable<ConversationChunk> {
    this.scrapes += 1;
    yield {
      tool: "codex",
      sessionId: "s",
      timestamp: new Date("2026-05-10T10:00:00.000Z"),
      role: "user",
      content: "hello from the store",
      metadata: { messageIndex: 0, tokenEstimate: 1, layer: 0 },
    };
  }
  async *fullSync(): AsyncIterable<ConversationChunk> {
    yield* this.scrape();
  }
  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }
  async saveScrapedPosition(): Promise<void> {}
}

/** A pid that certainly named a process on this machine, and no longer does. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid as number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the scan lease", () => {
  let dir = "";
  let db: DatabaseHandle;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-lease-"));
    db = openDatabase(join(dir, "xtctx.db"));
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("is refused to a second holder until the first releases it", () => {
    const first = new ScanLease(db);
    const second = new ScanLease(db);

    expect(first.tryAcquire()).toBe(true);
    expect(second.tryAcquire()).toBe(false);
    expect(second.heldElsewhere()).toBe(true);

    first.release();
    expect(second.tryAcquire()).toBe(true);
  });

  it("is taken over once it expires, and the old holder learns it lost it", () => {
    let now = 1_000_000;
    const first = new ScanLease(db, { now: () => now, ttlMs: 10_000 });
    const second = new ScanLease(db, { now: () => now, ttlMs: 10_000 });

    expect(first.tryAcquire()).toBe(true);
    now += 9_000;
    expect(second.tryAcquire()).toBe(false);
    now += 2_000;
    expect(second.tryAcquire()).toBe(true);

    now += SCAN_LEASE_RENEW_MS;
    expect(first.renew()).toBe(false);
    expect(second.renew()).toBe(true);
  });

  it("is taken over at once when its holder's process is gone", async () => {
    const pid = await deadPid();
    setSetting(
      db,
      SCAN_LEASE_KEY,
      JSON.stringify({
        token: "crashed",
        pid,
        host: hostname(),
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    );

    expect(new ScanLease(db).tryAcquire()).toBe(true);
  });

  it("is not taken from a live holder on another machine before it expires", () => {
    setSetting(
      db,
      SCAN_LEASE_KEY,
      JSON.stringify({
        token: "elsewhere",
        pid: 1,
        host: `${hostname()}-not-this-one`,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    );

    expect(new ScanLease(db, { isAlive: () => false }).tryAcquire()).toBe(false);
  });
});

describe("a server sharing an index with another server's scan", () => {
  let dir = "";
  let dbPath = "";
  let holderDb: DatabaseHandle | undefined;
  let index: SqliteHandoffIndex | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-lease-index-"));
    dbPath = join(dir, "xtctx.db");
    holderDb = openDatabase(dbPath);
  });

  afterEach(async () => {
    await index?.close().catch(() => {});
    index = undefined;
    holderDb?.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  function open(scraper: ConversationScraper): SqliteHandoffIndex {
    index = new SqliteHandoffIndex(dbPath, dir, [{ tool: "codex", scraper }], {
      refreshBudgetMs: 0,
    });
    return index;
  }

  it("waits while another holds the lease, then scans after it", async () => {
    const holder = new ScanLease(holderDb as DatabaseHandle);
    expect(holder.tryAcquire()).toBe(true);
    const scraper = new CountingScraper();
    const server = open(scraper);

    await server.listRecentSessions(5);
    await sleep(600);
    expect(scraper.scrapes).toBe(0);
    expect(server.getIndexProgress().scanning).toBe(true);

    holder.release();
    await server.whenScanSettled();
    expect(scraper.scrapes).toBe(1);
  });

  it("does not scan again when a scan that began after it asked has finished", async () => {
    const holder = new ScanLease(holderDb as DatabaseHandle);
    expect(holder.tryAcquire()).toBe(true);
    const scraper = new CountingScraper();
    const server = open(scraper);

    await server.listRecentSessions(5);
    await sleep(300);
    // Another server's scan, started after this one asked, completes.
    setSetting(holderDb as DatabaseHandle, SCAN_COMPLETED_FROM_KEY, String(Date.now()));
    holder.release();
    await server.whenScanSettled();

    expect(scraper.scrapes).toBe(0);
    // And its stores count as read for this process's progress notes.
    expect(server.getIndexProgress().unreadTools).toEqual([]);
  });

  it("is not blocked by a holder that crashed", async () => {
    setSetting(
      holderDb as DatabaseHandle,
      SCAN_LEASE_KEY,
      JSON.stringify({
        token: "crashed",
        pid: await deadPid(),
        host: hostname(),
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    );
    const scraper = new CountingScraper();
    const server = open(scraper);

    await server.listRecentSessions(5);
    await server.whenScanSettled();

    expect(scraper.scrapes).toBe(1);
    expect((await server.listIndexedSessions(5)).map((s) => s.session_ref)).toEqual(["codex:s"]);
  });

  it("closes promptly while only waiting", async () => {
    const holder = new ScanLease(holderDb as DatabaseHandle);
    expect(holder.tryAcquire()).toBe(true);
    const server = open(new CountingScraper());
    await server.listRecentSessions(5);

    const started = Date.now();
    await server.close();
    index = undefined;

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
