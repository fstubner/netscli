import { open, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "../utils/atomic-file.js";
import { recordDrift } from "./drift-log.js";
import type {
  ConversationChunk,
  ConversationScraper,
  EmittedPosition,
  FileCursor,
  IndexProbe,
  ScraperState,
} from "../types/scraper.js";

export class ScraperStateManager {
  constructor(private readonly stateDir: string) {}

  async load(tool: string): Promise<ScraperState> {
    const path = this.statePath(tool);

    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as ScraperState;
      const parsed = new Date(data.lastTimestamp);
      return {
        ...data,
        // An Invalid Date makes every cutoff comparison false, re-emitting
        // the full history on every scrape; reset to epoch instead.
        lastTimestamp: Number.isNaN(parsed.getTime()) ? new Date(0) : parsed,
      };
    } catch {
      return { lastTimestamp: new Date(0) };
    }
  }

  async save(tool: string, state: ScraperState): Promise<void> {
    // Was a hand-rolled tmp-then-rename through `<path>.tmp`. The rename half
    // was right — a mid-write crash must not leave a corrupt state file (M3) —
    // but the temp name was fully predictable and the write plain, so anything
    // pre-planted there was written through. `writeFileAtomic` is the same
    // pattern with a random suffix and `wx`, which is why it exists.
    await writeFileAtomic(this.statePath(tool), JSON.stringify(state, null, 2));
  }

  private statePath(tool: string): string {
    return join(this.stateDir, `${tool}-state.json`);
  }
}

export function estimateTokens(text: string): number {
  if (!text) return 0;

  const charCount = text.length;
  // Match programming syntax delimiters
  const symbolMatches = text.match(/[{}[\]();=+\-*&|<>!]/g);
  const symbolCount = symbolMatches ? symbolMatches.length : 0;

  // Text scales at 4 characters per token; symbols weight heavier (2 characters per token)
  const baseTokens = Math.ceil(charCount / 4);
  const syntaxTokens = Math.ceil(symbolCount / 2);

  return baseTokens + syntaxTokens;
}

/**
 * Coerce an unknown value to a Date.
 * Handles: Date objects, numeric timestamps (seconds or milliseconds),
 * numeric strings, ISO strings. Returns new Date(0) as sentinel for
 * unrecognised values.
 */
export function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  if (typeof value === "string" && value.length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") {
      const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      return new Date(millis);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
}

/**
 * Base class for all conversation scrapers — both built-in and community ones.
 *
 * Extend this class to add a new data source. You only need to implement five
 * members:
 *
 *   - `tool`           — unique string identifier (e.g. `"zed"`, `"aider"`)
 *   - `detect()`       — returns true when the data source is present on disk
 *   - `getStorePaths()` — transcript source paths used for detection and status
 *   - `scrape(since?)` — yield chunks newer than the given date (incremental)
 *   - `fullSync()`     — yield all chunks from the beginning of time
 *
 * State persistence (position tracking between scrape cycles) is handled
 * automatically by this base class via `ScraperStateManager`.
 *
 * @example
 * ```ts
 * import { AbstractScraper, estimateTokens } from "xtctx/scrapers";
 * import type { ConversationChunk } from "xtctx/scrapers";
 *
 * export class ZedScraper extends AbstractScraper {
 *   readonly tool = "zed";
 *
 *   constructor(private readonly historyDir: string, stateDir: string) {
 *     super(stateDir);
 *   }
 *
 *   async detect() { ... }
 *   getStorePaths() { return [this.historyDir]; }
 *   async *scrape(since?: Date) { ... }
 *   async *fullSync() { ... }
 * }
 * ```
 */
export abstract class AbstractScraper<T extends ConversationChunk = ConversationChunk>
  implements ConversationScraper<T>
{
  abstract readonly tool: string;

  private readonly stateManager: ScraperStateManager;

  /** Where this scraper's drift log is kept; passed to `withDriftReport`. */
  protected readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.stateManager = new ScraperStateManager(stateDir);
  }

  abstract detect(): Promise<boolean>;
  abstract getStorePaths(): string[];
  abstract scrape(since?: Date): AsyncIterable<T>;
  abstract fullSync(): AsyncIterable<T>;

  /** Set by the scan for the duration of a scrape; see `useIndexProbe`. */
  private indexProbe: IndexProbe | undefined;

  async getLastScrapedPosition(): Promise<ScraperState> {
    return this.stateManager.load(this.tool);
  }

  useIndexProbe(probe: IndexProbe | undefined): void {
    this.indexProbe = probe;
  }

  /**
   * Whether the index still holds what a cursor says was read.
   *
   * Only asked when a scan installed a probe; a scraper driven on its own has
   * no index to disagree with. A cursor from before `lastEmitted` existed is
   * refused once, so a file read through by an older version is read again —
   * which is what repairs an index the concurrent prune already damaged,
   * since nothing else can tell it apart from one that is whole.
   */
  protected cursorBackedByIndex(cursor: FileCursor): boolean {
    if (!this.indexProbe) {
      return true;
    }
    if (cursor.lastEmitted === undefined) {
      return false;
    }
    if (cursor.lastEmitted === null) {
      return true;
    }
    return this.indexProbe(cursor.lastEmitted.sessionId, cursor.lastEmitted.messageIndex);
  }

  /**
   * Merge into the stored state rather than replacing it.
   *
   * Two writers share this file and neither knows about the other's fields.
   * The index saves `{ lastTimestamp }` when a scrape completes; a scraper
   * saves `{ files }` as it goes. Replacing meant whichever wrote last erased
   * the other, and the per-file resume points would have been dropped on every
   * scan — silently, since losing them only costs a re-read.
   */
  async saveScrapedPosition(state: Partial<ScraperState>): Promise<void> {
    const existing = await this.stateManager.load(this.tool);
    await this.stateManager.save(this.tool, {
      ...existing,
      ...state,
      files: { ...(existing.files ?? {}), ...(state.files ?? {}) },
    });
  }
}

/**
 * Where to resume reading an append-only file, given what a previous scan
 * recorded and what the file looks like now.
 *
 * The shrink check is what makes resuming safe to assume rather than safe to
 * hope. These files are append-only in practice, but that is an observation
 * about how the tools behave today, not a guarantee any of them documents. A
 * file smaller than the offset we stored has been rewritten or truncated, so
 * the offset means nothing and the only correct move is to read it again from
 * the start. The optimisation then degrades to the behaviour it replaced,
 * rather than silently skipping content.
 */
export function resumeOffset(
  cursor: FileCursor | undefined,
  currentSize: number,
  currentHeadHash?: string,
  currentTailHash?: string,
): number {
  // No context means the derived state a resumed read depends on was never
  // recorded, so resuming would drop or misattribute everything after it.
  if (!cursor || cursor.offset <= 0 || !cursor.context) {
    return 0;
  }
  if (currentSize < cursor.offset) {
    return 0;
  }
  // A head that no longer matches means the file was rewritten rather than
  // appended to, so the offset points into different content.
  if (cursor.headHash !== undefined && cursor.headHash !== currentHeadHash) {
    return 0;
  }
  // The same, for a rewrite further in. See `fileTailHash`.
  if (cursor.tailHash !== undefined && cursor.tailHash !== currentTailHash) {
    return 0;
  }
  return cursor.offset;
}

/** Most leading bytes fingerprinted to tell an append from a rewrite. */
const FILE_HEAD_HASH_BYTES = 1024;

/**
 * Hash the leading bytes of a file, or null when it cannot be read.
 *
 * `upTo` bounds the window to bytes that were already present when the offset
 * was recorded. Hashing a fixed 1024 regardless would cover the whole of any
 * file shorter than that, so every append would change the hash and resume
 * would be refused forever — the check has to describe the part of the file
 * that appending cannot touch.
 *
 * Null means "unknown", and `resumeOffset` refuses to resume on it, which is
 * the safe direction: the cost is a re-read.
 */
export async function fileHeadHash(path: string, upTo: number): Promise<string | null> {
  return windowHash(path, 0, Math.min(FILE_HEAD_HASH_BYTES, Math.max(0, upTo)));
}

/**
 * Hash the bytes just before `upTo`, or null when there is nothing the head
 * hash does not already cover, or when they cannot be read.
 *
 * The head alone missed a rewrite past its first kilobyte. A transcript
 * rewritten with one early turn changed resumed at the old offset into
 * different content: the head was intact and the file had not shrunk, so
 * the read started mid-record and the changed turn kept its old text in the
 * index. Any rewrite that changes the length of something before the offset
 * moves the bytes that end there, so this window catches it.
 *
 * Sampled, not exhaustive: a same-length edit in the middle of a long file
 * changes neither window. Hashing the whole prefix would catch it, at the
 * price of re-reading every byte of every file on every scan, which is the
 * 18GB re-read resuming exists to avoid.
 */
export async function fileTailHash(path: string, upTo: number): Promise<string | null> {
  const start = Math.max(0, upTo - FILE_HEAD_HASH_BYTES);
  return start === 0 ? null : windowHash(path, start, upTo - start);
}

async function windowHash(path: string, start: number, length: number): Promise<string | null> {
  if (length <= 0) {
    return null;
  }

  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      if (bytesRead < length) {
        // Shorter than the window it was recorded over: rewritten, not
        // appended to.
        return null;
      }
      return createHash("sha256").update(buffer).digest("hex");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Where a yielded chunk will sit in the index, or undefined for one the index
 * will not store. The scan drops blank chunks, so recording one as the last
 * emitted would name a row that never exists and fail the cursor check on
 * every scan; see `cursorBackedByIndex`.
 */
export function emittedPosition(chunk: ConversationChunk): EmittedPosition | undefined {
  return chunk.content.trim()
    ? { sessionId: chunk.sessionId, messageIndex: chunk.metadata.messageIndex ?? 0 }
    : undefined;
}

/** A plain object: not null, not an array. The shape every parsed record is checked against first. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** `typeof` with the two cases it gets wrong for drift messages spelled out. */
export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Size in bytes, or null when it cannot be read — in which case do not resume. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** A non-negative integer position, or 0 for anything that is not one. */
export function toMessageIndex(value: unknown): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }

  return 0;
}

/**
 * A drift reporter bound to one scraper, so call sites name only the source
 * and the surprise. Each scraper keeps a module-level
 * `const warnDrift = driftWarner(SCRAPER_NAME)`.
 */
export function driftWarner(scraperName: string): (sourcePath: string, surprise: string) => void {
  return (sourcePath, surprise) => {
    recordDrift(scraperName, sourcePath, surprise);
  };
}
