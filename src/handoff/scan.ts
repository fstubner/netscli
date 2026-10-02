import type { Database as DatabaseHandle } from "better-sqlite3";
import type { ConversationChunk, ConversationScraper } from "../types/scraper.js";
import { hashParts } from "./hash.js";
import { type PreparedStatements, clearSetting, setSetting, unitsStaleKey } from "./schema.js";

/**
 * How often a session still streaming in from a scraper has its count and
 * preview rolled up. See the scan loop in `scanTool` for why it is not
 * "only at the end" and not "on every message".
 */
const INCREMENTAL_ROLLUP_INTERVAL_MS = 1_000;

const SOURCE_CURSOR_OVERLAP_MS = 1_000;

/**
 * Wait for the scan, but not past the budget. Nothing is cancelled on
 * timeout — the scan keeps running and keeps committing — so a caller that
 * stops waiting costs the index nothing, and the next call finds more.
 */
export async function waitWithBudget(
  scan: Promise<void>,
  scanStartedMs: number,
  refreshBudgetMs: number,
): Promise<void> {
  if (refreshBudgetMs === 0) {
    return;
  }

  // The budget is spent by the scan, not by each caller. Measuring it from
  // when the scan started means one call pays the wait and the calls behind
  // it return straight away with whatever has landed so far — rather than
  // every call in a session paying the full budget over again.
  const remaining = scanStartedMs + refreshBudgetMs - Date.now();
  if (remaining <= 0) {
    return;
  }

  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, remaining);
    // Do not hold the process open just to enforce a deadline.
    timer.unref?.();
  });

  try {
    await Promise.race([scan.catch(() => {}), budget]);
  } finally {
    clearTimeout(timer);
  }
}

interface ScanToolDeps {
  db: DatabaseHandle;
  stmts: PreparedStatements;
  /** Canonical and normalized; see `canonicalRoot` in queries. */
  scopedRoot: string;
  /**
   * Awaited after every chunk is written. Lets the caller yield the event loop
   * during a long scan and stop it by throwing `ScanInterrupted`.
   */
  checkpoint?: () => Promise<void>;
}

/**
 * Thrown from a checkpoint to stop a scan between two writes.
 *
 * Not a failure of the store, so it is not recorded against the tool, and the
 * scan stops the way a killed process does: everything written stays
 * written, nothing after the last write is claimed — the scraper's cursors
 * and the timestamp cursor are saved only when a scrape runs to its end — and
 * the sessions it touched stay marked for the windows it did not build.
 */
export class ScanInterrupted extends Error {
  constructor(reason: string) {
    super(`scan interrupted: ${reason}`);
    this.name = "ScanInterrupted";
  }
}

interface ScanToolResult {
  /** Every session this scan wrote to; the caller rolls them up at the end. */
  touchedSessions: string[];
  /**
   * The tool that was read, in the sense of "looked at in this process" —
   * reported whether or not the read succeeded; see `scannedTools` on the
   * index.
   */
  tool: string;
}

/**
 * Read one tool's store into the index, advancing its cursor on success.
 *
 * Reports the tool as scanned whether or not the read succeeded, and records
 * a failure under `last_error:<tool>` without moving the cursor.
 */
export async function scanTool(
  scraper: ConversationScraper,
  deps: ScanToolDeps,
): Promise<ScanToolResult> {
  const { db, stmts, scopedRoot } = deps;
  // Insertion-ordered and de-duplicated, so folding this into the caller's
  // own set preserves the order the caller used to build it in.
  const touchedSessions = new Set<string>();
  // What this scan wrote, per session: every id, and the lowest position it
  // reached. Against the lowest position already stored — captured before the
  // first write to that session — they say whether this scan's rows are the
  // complete account of the session from that point on. See
  // `pruneRereadSessions`.
  const writtenIds = new Map<string, Set<string>>();
  const lowestWritten = new Map<string, number>();
  const lowestStored = new Map<string, number | null>();
  // Taken before anything is read. Rows indexed after it were written by
  // someone else while this scan ran, and are never this scan's to prune.
  const scanStartedAt = new Date().toISOString();
  if (!(await safeDetect(scraper))) {
    // Not installed here, so there is nothing to wait for — read, rather
    // than outstanding forever.
    return { touchedSessions: [], tool: scraper.tool };
  }

  let latestTimestamp: Date | null = null;
  // The session the scraper is currently yielding. It is rolled up when
  // the scraper moves on to another, and at most once a second while it
  // is still streaming in, so a scan cut short — the normal case when a
  // 20-second agent session ends before a 20-second scan does — leaves a
  // count and a preview behind rather than "0 messages" and nothing. The
  // timer matters more than the switch: the session the next agent wants
  // is the newest one, which is the last file a scraper reads, so nothing
  // ever moves past it before an interruption. Once per second keeps the
  // roll-up from being paid per message, which is what made indexing
  // O(N²) per session before it was deferred to the end. Retrieval units
  // still wait for the end: only search reads them, and search scans for
  // itself.
  let openSession: string | null = null;
  let openSessionRolledUpAt = 0;
  // Lets a scraper with byte cursors refuse one the index no longer backs.
  const tool = scraper.tool;
  scraper.useIndexProbe?.(
    (sessionId, messageIndex) =>
      stmts.messageAtIndex.get(`${tool}:${sessionId}`, messageIndex) !== undefined,
  );
  try {
    for await (const chunk of scraper.scrape()) {
      // Before the write, or the row about to be inserted would move the
      // minimum this comparison depends on.
      const chunkSessionRef = `${chunk.tool}:${chunk.sessionId}`;
      if (!lowestStored.has(chunkSessionRef)) {
        const row = stmts.minMessageIndexForSession.get(chunkSessionRef) as
          | { lowest: number | null }
          | undefined;
        lowestStored.set(chunkSessionRef, row?.lowest ?? null);
        // Committed before the first row, so a scan cut off anywhere after
        // this leaves the session marked for the rebuild it never reached.
        stmts.markUnitsStale.run(unitsStaleKey(chunkSessionRef), new Date().toISOString());
      }

      const written = upsertChunk(stmts, scopedRoot, chunk);
      if (written) {
        const { sessionRef } = written;
        touchedSessions.add(sessionRef);

        let ids = writtenIds.get(sessionRef);
        if (!ids) {
          ids = new Set<string>();
          writtenIds.set(sessionRef, ids);
        }
        ids.add(written.id);

        const lowest = lowestWritten.get(sessionRef);
        if (lowest === undefined || written.messageIndex < lowest) {
          lowestWritten.set(sessionRef, written.messageIndex);
        }
        if (openSession !== null && openSession !== sessionRef) {
          stmts.sessionRollup.run(openSession);
          openSessionRolledUpAt = 0;
        }
        openSession = sessionRef;
        if (Date.now() - openSessionRolledUpAt >= INCREMENTAL_ROLLUP_INTERVAL_MS) {
          stmts.sessionRollup.run(openSession);
          openSessionRolledUpAt = Date.now();
        }
      }
      if (!latestTimestamp || chunk.timestamp > latestTimestamp) {
        latestTimestamp = chunk.timestamp;
      }
      await deps.checkpoint?.();
    }

    // Only after the scrape completed. A scrape that threw has an incomplete
    // set of written ids, and pruning against it would delete rows for
    // everything it never reached.
    pruneRereadSessions(db, stmts, writtenIds, lowestWritten, lowestStored, scanStartedAt);

    if (latestTimestamp) {
      await scraper.saveScrapedPosition({
        lastTimestamp: overlapTimestamp(latestTimestamp),
      });
    }
    clearSetting(db, `last_error:${scraper.tool}`);
  } catch (error) {
    if (error instanceof ScanInterrupted) {
      throw error;
    }
    setSetting(
      db,
      `last_error:${scraper.tool}`,
      error instanceof Error ? error.message : String(error),
    );
    // Deliberately do NOT advance the cursor here: chunks yielded before
    // the failure may sort after content in files never reached, and
    // advancing would skip that content permanently. Re-scraping the
    // same window is safe (message ids are deterministic hashes).
  } finally {
    scraper.useIndexProbe?.(undefined);
    // The last session a scraper yielded has nobody to move past it.
    if (openSession !== null) {
      stmts.sessionRollup.run(openSession);
    }
  }

  // Read, whether or not it succeeded: a tool whose scrape failed has
  // an error recorded against it and is not something the caller should
  // be told to wait for. "Outstanding" here means "not looked at yet in
  // this process", nothing more.
  return { touchedSessions: [...touchedSessions], tool: scraper.tool };
}

/** What one written chunk tells the scan about the session it belongs to. */
interface WrittenChunk {
  sessionRef: string;
  /**
   * The row's deterministic id. Collected per session so a read that started
   * at the top can delete what it did not produce; see `pruneRereadSessions`.
   */
  id: string;
  messageIndex: number;
}

/** Writes one chunk; returns what was written, or null for an empty chunk. */
function upsertChunk(
  stmts: PreparedStatements,
  scopedRoot: string,
  chunk: ConversationChunk,
): WrittenChunk | null {
  if (!chunk.content.trim()) {
    return null;
  }

  const timestamp = chunk.timestamp.toISOString();
  const sessionRef = `${chunk.tool}:${chunk.sessionId}`;
  const messageIndex = chunk.metadata.messageIndex ?? 0;
  const id = hashParts([
    chunk.tool,
    chunk.sessionId,
    timestamp,
    chunk.role,
    String(messageIndex),
    chunk.content,
  ]);
  const contentHash = hashParts([chunk.content]);
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(chunk.metadata ?? {});
  const sourcePointer = sourcePathFromMetadata(chunk.metadata);

  stmts.upsertChunkTxn(
    [
      sessionRef,
      chunk.tool,
      chunk.sessionId,
      // Canonical and normalized, matching what the read filter compares
      // against. Writing the raw root here is what made rows invisible when
      // the reader resolved a symlink and the writer had not.
      scopedRoot,
      chunk.metadata?.gitBranch ?? null,
      chunk.metadata?.gitCommit ?? null,
      timestamp,
      timestamp,
      sourcePointer,
      now,
    ],
    [
      id,
      sessionRef,
      chunk.tool,
      chunk.sessionId,
      timestamp,
      chunk.role,
      chunk.content,
      messageIndex,
      contentHash,
      metadataJson,
      sourcePointer,
      now,
    ],
  );

  return { sessionRef, id, messageIndex };
}

/**
 * Delete rows a full re-read of a session did not produce.
 *
 * Message ids hash the message index, so a turn that moves position between
 * two reads arrives under a new id and inserts *alongside* its old row rather
 * than replacing it. Nothing else removes the old one, so the session ends up
 * holding the same turn at two positions. Positions move whenever a read sees
 * a different set of records than the read before it — a scraper taught to
 * read something it used to skip, or a transcript rewritten underneath.
 *
 * A session is eligible when this scan reached at least as far back as the
 * lowest position already stored for it: everything on record from that point
 * on is then accounted for by what this scan wrote, so a row it did not write
 * is stale. A resumed read starts past that point and is never eligible —
 * pruning on one would delete the whole history before its resume point.
 *
 * The obvious signal, "the scan wrote index 0", is wrong and was tried: every
 * scraper advances `messageIndex` over records it skips, so a real session's
 * lowest written position is whatever survived the skipping. Across nine real
 * Codex sessions those minima were 2, 2, 3, 3, 3, 3, 5, 5 and 5 — never 0, so
 * that version of this prune never ran on real data while its test, whose
 * fixture started at 0, passed.
 *
 * Only rows indexed no later than this scan began are candidates. Another
 * server scanning the same index can insert rows for lines appended after this
 * scan read the file; they are absent from what this scan wrote for the
 * plainest reason, that it never saw them, and deleting them lost them for
 * good — the other server's cursor already sat past those lines. Measured with
 * three servers over a 10,000-message corpus while sessions grew: 70 to 74
 * rows lost in every run. One scanner per project at a time (`ScanLease`) is
 * what prevents the overlap; this bound is what keeps an overlap that happens
 * anyway — a lease taken over from a holder that stalled past its expiry —
 * from costing data. A row indexed at the very millisecond the
 * scan began is still a candidate: whoever wrote it read those lines before
 * this scan started reading, so this scan read them too.
 *
 * The caller re-runs the roll-up and rebuilds retrieval units for every
 * touched session afterwards, which is what repairs `message_count` and the
 * search windows over the rows this removes.
 */
function pruneRereadSessions(
  db: DatabaseHandle,
  stmts: PreparedStatements,
  writtenIds: Map<string, Set<string>>,
  lowestWritten: Map<string, number>,
  lowestStored: Map<string, number | null>,
  scanStartedAt: string,
): void {
  for (const [sessionRef, written] of writtenIds) {
    if (written.size === 0) {
      continue;
    }

    const stored = lowestStored.get(sessionRef);
    const reached = lowestWritten.get(sessionRef);
    // Nothing stored before this scan means nothing can be stale.
    if (stored === null || stored === undefined || reached === undefined || reached > stored) {
      continue;
    }

    const stale = (
      stmts.selectPrunableMessageIds.all(sessionRef, scanStartedAt) as Array<{ id: string }>
    )
      .map((row) => row.id)
      .filter((id) => !written.has(id));
    if (stale.length === 0) {
      continue;
    }

    db.transaction(() => {
      for (const id of stale) {
        stmts.deleteMessageById.run(id);
      }
    })();
  }
}

function sourcePathFromMetadata(metadata: ConversationChunk["metadata"]): string | null {
  const value = (metadata as { sourcePath?: unknown }).sourcePath;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function overlapTimestamp(value: Date): Date {
  return new Date(Math.max(0, value.getTime() - SOURCE_CURSOR_OVERLAP_MS));
}

export async function safeDetect(scraper: ConversationScraper): Promise<boolean> {
  try {
    return await scraper.detect();
  } catch {
    return false;
  }
}
