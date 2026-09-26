import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database as DatabaseHandle } from "better-sqlite3";
import type { ConversationScraper } from "../types/scraper.js";
import {
  DEFAULT_EMBEDDING_MODEL,
  TransformersEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.js";
import type {
  HandoffStatus,
  IndexProgress,
  SessionMessage,
  SessionSearchMode,
  SessionService,
  SessionSummary,
} from "./types.js";
import { cosineSimilarity, deserializeVector } from "./vector.js";
import { NullEmbeddingProvider } from "./null-embeddings.js";
import {
  DEFAULT_WINDOW_SIZE,
  DEFAULT_WINDOW_STRIDE,
  type MessageRow,
  planRetrievalUnits,
} from "./retrieval-units.js";
import { scanTool, waitWithBudget } from "./scan.js";
import { literalSearch } from "./literal-search.js";
import {
  type PreparedStatements,
  SchemaVersionError,
  clearSetting,
  isCorruptDatabaseError,
  openDatabase,
  placeholders,
  prepareStatements,
  setSetting,
} from "./schema.js";
import {
  PROJECT_ROOT_SQL,
  countWhere,
  normalizeRootForCompare,
  retrievalUnitSelect,
  toFtsQuery,
} from "./queries.js";
import { buildIndexProgress, buildStatus } from "./status.js";
import {
  countUnvectorizedUnits,
  dropVectorsFromOtherModels,
  ensureVectors,
  waitUntilEmbeddingReady,
} from "./vectors.js";
import {
  groupUnits,
  rankKeywordRows,
  rankSearchCandidates,
  type RetrievalUnitRow,
  type VectorUnitRow,
} from "./ranking.js";

interface ToolRuntime {
  tool: string;
  scraper: ConversationScraper;
}

interface SqliteHandoffIndexOptions {
  embeddingProvider?: EmbeddingProvider;
  windowSize?: number;
  windowStride?: number;
  /** How long a caller waits for a scan before taking what is indexed so far. */
  refreshBudgetMs?: number;
  /** How long a scan waits for the embedding model to load. */
  embeddingWarmBudgetMs?: number;
  /** How long one search spends building vectors before answering with what it has. */
  vectorBudgetMs?: number;
  /** How long a literal pass reads transcript stores before answering. */
  literalBudgetMs?: number;
  /**
   * Whether opening the index may create it.
   *
   * `xtctx status` is a diagnostic — it should be able to report on a
   * project without leaving a database behind in one it was only asked to
   * look at. When false and no index exists, reads run against an in-memory
   * database and report zeros, which is the truth for a project that has
   * never been set up.
   */
  createIfMissing?: boolean;
  /**
   * Enabled tools whose store this project's config redirects outside the
   * home directory. Reported in status; see `redirectedTools` in
   * `runtime/services.ts` for why it is worth saying.
   */
  redirectedTools?: string[];
  /**
   * Stop searches from vectorizing anything they find unvectorized.
   *
   * For measuring how retrieval behaves at a given fraction of the corpus
   * embedded, which is the ordinary state of a fresh index and cannot be held
   * still otherwise: `vectorBudgetMs` bounds a pass but the deadline is
   * checked between batches, so one full batch always runs and the fraction
   * under test refills before it can be scored.
   *
   * Not a product setting. Nothing in `src/` passes it — an index that never
   * embeds is a search that degrades to keyword forever.
   */
  freezeVectors?: boolean;
  /** Per-window cosine floor; see ranking.ts. */
  minSemanticCosine?: number;
  /** Best-window confidence floor; see ranking.ts. */
  minConfidentCosine?: number;
}

/**
 * How long a tool call will wait for a scan of every transcript store on the
 * machine.
 *
 * A cold scan here takes about 55 seconds — 18GB of codex history is most of
 * it — and it used to run inside the caller's first tool call. MCP servers are
 * spawned per agent session, so that was paid on every handoff, and a host
 * with a 30s tool timeout never got a first answer at all.
 *
 * The scan is not cancelled when the budget expires; the caller just stops
 * waiting for it. Everything it has already written stays written, so the next
 * call sees more, and the call after that sees all of it.
 */
const DEFAULT_REFRESH_BUDGET_MS = 4_000;

/**
 * How long one search spends building vectors before answering.
 *
 * The first semantic search used to vectorize the entire corpus inline: 530
 * seconds on a 1,145-window index, inside a single tool call, with no cap and
 * nothing to show for the wait. Each batch commits on its own, so stopping
 * early costs nothing — the next search picks up where this one stopped, and
 * recall improves call over call until the corpus is covered.
 */
const DEFAULT_VECTOR_BUDGET_MS = 6_000;

/**
 * How long a literal pass spends reading transcript stores.
 *
 * Its own budget, not the refresh one. `refreshBudgetMs: 0` means "do not
 * wait for a scan", which is a reasonable thing to ask for and says nothing
 * about how long a search may take — reusing it made a literal search with
 * that setting return nothing at all, immediately, and call itself complete.
 *
 * Sized as a search a person is waiting on rather than as a scan: this route
 * exists to answer while the index is still filling, so spending longer than
 * the scan would defeat it.
 */
const DEFAULT_LITERAL_BUDGET_MS = 5_000;

interface SessionRow {
  session_ref: string;
  tool: string;
  started_at: string;
  last_activity_at: string;
  message_count: number;
  preview: string | null;
  source_path: string | null;
  git_branch: string | null;
  git_commit: string | null;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

/**
 * Sessions repaired per scan by `reconcileRetrievalUnits`.
 *
 * Small on purpose: rebuilding reads every message in a session, and scans
 * here are routinely cut short by the client disconnecting, so a large batch
 * would be killed before finishing and would repeat the same prefix next time.
 * A backlog drains over a few scans instead, newest first.
 */
const RETRIEVAL_UNIT_RECONCILE_LIMIT = 4;

/**
 * How long a scan waits for the embedding model to finish loading.
 *
 * Sized against both failure modes. A warm cache loads in about a second, so
 * this clears it comfortably and every run after the first vectorises — the
 * case that was never happening. A cold cache takes minutes, misses this, and
 * is left to load in the background, which is correct: `close()` waits for the
 * scan, so this budget is also shutdown latency and cannot be generous.
 */
const DEFAULT_EMBEDDING_WARM_BUDGET_MS = 5_000;

/**
 * The real model unless `XTCTX_DISABLE_EMBEDDINGS=1`.
 *
 * The switch is for the test suite, where several workers each loading a
 * ~100MB ONNX model exhausted memory and killed the worker rather than
 * failing an embedding. Search already degrades to keyword without vectors,
 * so a suite that is not asserting embeddings loses no coverage by skipping
 * the load — and the one test that is asserting them constructs the real
 * provider directly, so it still exercises the real thing.
 */
function defaultEmbeddingProvider(): EmbeddingProvider {
  return process.env.XTCTX_DISABLE_EMBEDDINGS === "1"
    ? new NullEmbeddingProvider()
    : new TransformersEmbeddingProvider(DEFAULT_EMBEDDING_MODEL);
}

/**
 * Override for the warm budget, in milliseconds; `0` disables the wait.
 *
 * The wait exists because this process is usually the only one there will be,
 * so deferring vectorising to "the next scan" meant never. That reasoning does
 * not apply to a test, where every scan would block on a model load nothing in
 * the test is asserting — and with a suite fanned out across workers, each one
 * paying that separately is contention rather than coverage.
 */
function embeddingWarmBudgetFromEnv(): number | undefined {
  const raw = Number.parseInt(process.env.XTCTX_EMBEDDING_WARM_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

/**
 * Candidate windows fetched per requested session.
 *
 * Not the same number as the matches shown. The keyword pass fetches windows,
 * and the ranker groups them into sessions afterwards — so a corpus where
 * sessions have many windows can spend the whole candidate budget on a
 * handful of them and cut the answering session before ranking ever sees it.
 * At `limit * 3` on sessions of four windows, fifteen candidates could not
 * reliably span five distinct sessions.
 *
 * Swept against the eval; see the table on `blendScores`.
 */
const CANDIDATE_WINDOWS_PER_SESSION = 12;

/**
 * The project root as the filesystem reports it, so writes and reads agree.
 *
 * Resolving at both ends is what makes the comparison work at all. One
 * directory has two names whenever a symlink is involved — a macOS temp
 * directory is `/var/...` and `/private/var/...`, and `createProjectServices`
 * already resolves it while a directly-constructed index did not. Rows
 * written under one name were then invisible under the other, which reads as
 * an empty project rather than as a bug.
 *
 * Falls back to the given path when it is not on disk, which is the case for
 * diagnostics and for a project that has moved.
 */
function canonicalRoot(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch {
    return projectRoot;
  }
}

export class SqliteHandoffIndex implements SessionService {
  private db: DatabaseHandle | null = null;
  /** Set by close(); an open still in flight then closes what it opened. */
  private closed = false;
  private stmts: PreparedStatements | null = null;
  private initialized: Promise<void>;
  private refreshPromise: Promise<void> | null = null;
  private lastRefreshMs = 0;
  /**
   * How long an indexed view is treated as current.
   *
   * A scan re-reads every transcript store on the machine, so at five seconds
   * almost every tool call in a session started a fresh one and paid the wait
   * budget again. The transcripts being read belong to sessions that ended
   * before this one started; they do not change second to second.
   */
  private readonly refreshTtlMs = 30_000;
  private readonly refreshBudgetMs: number;
  private readonly literalBudgetMs: number;
  /**
   * Whether the last literal search read everything it was asked to, or
   * stopped on its limit or budget. Undefined until one has run.
   */
  private lastLiteralWasExhaustive: boolean | undefined;
  /**
   * Tools whose store threw during the last literal pass.
   *
   * Kept apart from the flag above because the two need opposite advice:
   * hitting the limit is fixed by narrowing the query, and an unreadable
   * store is not fixed by retrying at all.
   */
  private lastLiteralUnreadable: string[] = [];

  /**
   * Forget the last literal pass's advice, at the start of every retrieval.
   *
   * Both fields above were written by a literal search and never cleared,
   * while `getIndexProgress` — which every tool calls — reports them. So one
   * truncated literal search attached "The literal pass stopped at its limit
   * or time budget. Narrow the query or raise `limit`." to every later
   * `xtctx_recent_sessions` and `xtctx_session_detail` answer, calls that
   * carry no query to narrow.
   *
   * The advice belongs to the call that produced it, not to the index. Cleared
   * on entry rather than consumed on read, because a literal search sets them
   * after this runs and before its own progress note is built, and nothing
   * then depends on how many times that note is asked for.
   */
  private clearLiteralAdvice(): void {
    this.lastLiteralWasExhaustive = undefined;
    this.lastLiteralUnreadable = [];
  }
  private readonly embeddingWarmBudgetMs: number;
  private readonly vectorBudgetMs: number;
  private scanStartedMs = 0;
  private readonly createIfMissing: boolean;
  /** Canonical, and compared normalized; see `canonicalRoot`. */
  private readonly scopedRoot: string;
  /**
   * Tools whose store this process has finished reading at least once.
   *
   * The answer budget stops the *caller* waiting, not the scan — so a first
   * call routinely returns before every store has been read, and used to
   * report only that indexing was "in progress". An agent asking whether
   * another tool had history here saw a plausible list with no sign that the
   * tool it cared about had not been looked at, and concluded there was
   * nothing to find. Naming the outstanding tools is what makes a partial
   * answer legible as partial.
   *
   * Per process, not persisted: it answers "have I read this yet, now", which
   * a previous run cannot vouch for.
   */
  private readonly scannedTools = new Set<string>();
  private readonly redirectedTools: string[];
  private readonly freezeVectors: boolean;
  /** Windows still waiting to be vectorized after the last search gave up its budget. */
  private vectorBacklog = 0;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly windowSize: number;
  private readonly windowStride: number;
  private readonly minSemanticCosine: number | undefined;
  private readonly minConfidentCosine: number | undefined;

  constructor(
    private readonly dbPath: string,
    private readonly projectRoot: string,
    private readonly tools: ToolRuntime[],
    options: SqliteHandoffIndexOptions = {},
  ) {
    this.embeddingProvider =
      options.embeddingProvider ?? defaultEmbeddingProvider();
    this.windowSize = Math.max(2, Math.floor(options.windowSize ?? DEFAULT_WINDOW_SIZE));
    this.windowStride = Math.max(1, Math.floor(options.windowStride ?? DEFAULT_WINDOW_STRIDE));
    this.minSemanticCosine = options.minSemanticCosine;
    this.minConfidentCosine = options.minConfidentCosine;
    this.refreshBudgetMs = Math.max(0, options.refreshBudgetMs ?? DEFAULT_REFRESH_BUDGET_MS);
    this.literalBudgetMs = Math.max(0, options.literalBudgetMs ?? DEFAULT_LITERAL_BUDGET_MS);
    this.embeddingWarmBudgetMs = Math.max(
      0,
      options.embeddingWarmBudgetMs ??
        embeddingWarmBudgetFromEnv() ??
        DEFAULT_EMBEDDING_WARM_BUDGET_MS,
    );
    this.vectorBudgetMs = Math.max(0, options.vectorBudgetMs ?? DEFAULT_VECTOR_BUDGET_MS);
    this.createIfMissing = options.createIfMissing ?? true;
    this.scopedRoot = normalizeRootForCompare(canonicalRoot(projectRoot));
    this.redirectedTools = options.redirectedTools ?? [];
    this.freezeVectors = options.freezeVectors ?? false;
    this.initialized = this.initialize();
    // Attach a no-op handler so a failed open cannot become an unhandled
    // rejection (which would kill the process) before the first caller
    // awaits; each awaiter of `initialized` still observes the rejection.
    this.initialized.catch(() => {});
  }

  async listRecentSessions(
    limit: number,
    toolFilter?: string[],
    branchFilter?: string[],
  ): Promise<SessionSummary[]> {
    this.clearLiteralAdvice();
    await this.refresh({ toolFilter });
    const db = this.getDb();
    const normalizedLimit = normalizeLimit(limit, DEFAULT_LIMIT);
    const filters = normalizeToolFilter(toolFilter);
    const branches = normalizeToolFilter(branchFilter);
    // Always first, and not optional. `project_root` was written on every
    // insert and read by nothing, so an index that outlived its project —
    // a renamed directory, a copied `.xtctx/`, a worktree made from a
    // checkout that already had one — served the old path's conversations as
    // this project's. Defence in depth behind the scrapers' own attribution.
    const clauses: string[] = [`${PROJECT_ROOT_SQL} = ?`];
    if (filters.length > 0) {
      clauses.push(`tool IN (${placeholders(filters.length)})`);
    }
    if (branches.length > 0) {
      // A session with no recorded branch is not evidence that it was on the
      // requested one, so it is excluded rather than assumed in.
      clauses.push(`git_branch IN (${placeholders(branches.length)})`);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .prepare(
        `SELECT session_ref, tool, started_at, last_activity_at, message_count, preview, source_path,
                git_branch, git_commit
         FROM sessions
         ${where}
         ORDER BY last_activity_at DESC
         LIMIT ?`,
      )
      .all(this.scopedRoot, ...filters, ...branches, normalizedLimit) as SessionRow[];

    return rows.map(formatSessionRow);
  }

  /**
   * What is already indexed, with no scan and no waiting.
   *
   * The SessionStart hook runs before the user has typed anything, so it
   * cannot afford the scan `listRecentSessions` starts — even bounded, that
   * is four seconds added to every agent startup. Priming with slightly
   * stale context instantly beats priming with fresh context late.
   */
  async listIndexedSessions(limit: number): Promise<SessionSummary[]> {
    await this.whenReady();
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT session_ref, tool, started_at, last_activity_at, message_count, preview, source_path,
                git_branch, git_commit
         FROM sessions
         WHERE ${PROJECT_ROOT_SQL} = ?
         ORDER BY last_activity_at DESC
         LIMIT ?`,
      )
      .all(this.scopedRoot, normalizeLimit(limit, DEFAULT_LIMIT)) as SessionRow[];

    return rows.map(formatSessionRow);
  }
  async getSessionByRef(sessionRef: string): Promise<SessionSummary | null> {
    await this.refresh({ sessionRef });
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT session_ref, tool, started_at, last_activity_at, message_count, preview, source_path,
                git_branch, git_commit
         FROM sessions
         WHERE session_ref = ?
           AND ${PROJECT_ROOT_SQL} = ?`,
      )
      .get(sessionRef, this.scopedRoot) as SessionRow | undefined;

    return row ? formatSessionRow(row) : null;
  }

  async getSessionDetail(
    sessionRef: string,
    offset: number,
    limit: number,
  ): Promise<SessionMessage[]> {
    this.clearLiteralAdvice();
    await this.refresh({ sessionRef });
    const db = this.getDb();
    const normalizedOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const normalizedLimit = normalizeLimit(limit, 50);
    const rows = db
      .prepare(
        `SELECT id, timestamp, role, content, message_index, source_pointer
         FROM messages
         WHERE session_ref = ?
           AND session_ref IN (
                 SELECT session_ref FROM sessions
                 WHERE ${PROJECT_ROOT_SQL} = ?
               )
         ORDER BY timestamp ASC, message_index ASC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(sessionRef, this.scopedRoot, normalizedLimit, normalizedOffset) as MessageRow[];

    return rows.map((row) => ({
      timestamp: row.timestamp,
      role: row.role,
      content: row.content,
      source_pointer: row.source_pointer ?? undefined,
    }));
  }

  async searchSessions(
    query: string,
    limit: number,
    toolFilter?: string[],
    mode: SessionSearchMode = "hybrid",
    branchFilter?: string[],
  ): Promise<SessionSummary[]> {
    this.clearLiteralAdvice();
    const normalizedModeForRefresh = normalizeSearchMode(mode);
    // A literal pass reads the stores, not the index, so it starts the scan
    // and moves on rather than waiting out the refresh budget in front of its
    // own. Every other mode reads the index and waits as before.
    await this.refresh({ toolFilter, noWait: normalizedModeForRefresh === "literal" });
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const normalizedMode = normalizedModeForRefresh;

    // Answered without the index: the refresh above was started but not waited
    // on, and nothing below touches the database.
    if (normalizedMode === "literal") {
      const { sessions, exhausted, unreadable } = await literalSearch(
        this.tools,
        trimmed,
        { limit: normalizeLimit(limit, DEFAULT_LIMIT), budgetMs: this.literalBudgetMs },
        toolFilter,
      );
      this.lastLiteralWasExhaustive = exhausted;
      this.lastLiteralUnreadable = unreadable;
      return sessions;
    }

    if (normalizedMode === "keyword") {
      return this.keywordSearch(trimmed, limit, toolFilter, branchFilter);
    }

    // Loading the embedding model is a one-off that takes minutes on a cold
    // cache. Hybrid is the default mode, so blocking it on that made the first
    // search of a session look broken. Start the load, answer from keyword,
    // and let the next search use the model. An explicit `vector` request is a
    // different matter: there is no other route, so that one waits.
    if (normalizedMode === "hybrid" && this.embeddingProvider.isReady?.() === false) {
      // A load that FAILED is not a load still running, and this branch used
      // to treat them the same. `warm()` swallows its error and `isReady()`
      // stays false afterwards, so a model that could not be fetched at all
      // returned keyword results with "still loading, ask again shortly" on
      // every call for the life of the project — advice that could never come
      // true — while `last_error:embeddings` stayed empty because the only
      // code that writes it is the catch below, which this return skips.
      const loadError = this.embeddingProvider.loadError?.();
      if (loadError !== undefined) {
        setSetting(this.getDb(), "last_error:embeddings", loadError);
      }
      // Retried regardless: the reason is usually a cold cache behind a flaky
      // network, which succeeds on a later attempt, and the setting is cleared
      // when it does.
      this.embeddingProvider.warm?.();
      return this.keywordSearch(trimmed, limit, toolFilter, branchFilter);
    }

    try {
      const results = await this.semanticSearch(
        trimmed,
        limit,
        toolFilter,
        normalizedMode,
        branchFilter,
      );
      clearSetting(this.getDb(), "last_error:embeddings");
      return results;
    } catch (error) {
      if (normalizedMode === "hybrid") {
        // Degrading to keyword keeps search useful, but a broken embedding
        // path must not be invisible: it silently returned keyword-only
        // results for every user while status still read healthy.
        const message = error instanceof Error ? error.message : String(error);
        setSetting(this.getDb(), "last_error:embeddings", message);
        process.stderr.write(`xtctx: semantic search unavailable, using keyword only (${message})\n`);
        return this.keywordSearch(trimmed, limit, toolFilter, branchFilter);
      }
      throw error;
    }
  }

  async getStatus(): Promise<HandoffStatus> {
    await this.refresh({ statusOnly: true });
    return buildStatus({
      db: this.getDb(),
      scopedRoot: this.scopedRoot,
      projectRoot: this.projectRoot,
      dbPath: this.dbPath,
      tools: this.tools,
      redirectedTools: this.redirectedTools,
      vectorModel: this.embeddingProvider.model,
      vectorDevice: this.embeddingProvider.device ?? null,
    });
  }

  async close(): Promise<void> {
    // Set first, so a retry that starts after this cannot open the database
    // again, and one already running closes what it opened (see initialize).
    this.closed = true;
    await this.initialized.catch(() => {});
    // A scan may still be running because a caller stopped waiting for it.
    // Closing the database underneath it would turn an ordinary shutdown into
    // a write to a closed handle.
    await this.whenScanSettled();
    this.discardHandle();
  }

  private async refresh(reason: {
    toolFilter?: string[];
    sessionRef?: string;
    statusOnly?: boolean;
    /**
     * Start a scan if one is due, but do not wait for it.
     *
     * For a caller that does not read the index. A literal search streams the
     * transcript stores directly — that is the whole reason it exists, to
     * answer while the index is still filling — and it was still paying up to
     * `refreshBudgetMs` first, for a scan whose results it never touches. On
     * the defaults that is four seconds of waiting in front of its own five,
     * on the one route chosen for being fast when the index is cold.
     *
     * The scan is still started, because the next caller does read the index
     * and a literal search is often the first call in a session.
     */
    noWait?: boolean;
  }): Promise<void> {
    await this.whenReady();
    if (reason.statusOnly) {
      return;
    }

    if (Date.now() - this.lastRefreshMs < this.refreshTtlMs) {
      return;
    }

    if (!this.refreshPromise) {
      const running = this.refreshNow().finally(() => {
        // Stamp the TTL on failure as well as success so a persistently
        // broken refresh backs off instead of re-running on every call.
        this.lastRefreshMs = Date.now();
        this.refreshPromise = null;
      });
      // A caller may stop waiting on this promise, so it needs its own
      // handler: an unhandled rejection would take the process down.
      running.catch(() => {});
      this.refreshPromise = running;
      this.scanStartedMs = Date.now();
    }

    await waitWithBudget(
      this.refreshPromise,
      this.scanStartedMs,
      reason.noWait ? 0 : this.refreshBudgetMs,
    );
  }

  /** True when a scan started by an earlier call is still running. */
  isScanning(): boolean {
    return this.refreshPromise !== null;
  }

  getIndexProgress(): IndexProgress {
    return buildIndexProgress({
      scanning: this.isScanning(),
      tools: this.tools,
      scannedTools: this.scannedTools,
      vectorBacklog: this.countUnvectorizedUnits(),
      // Asked, not remembered. The flag was only ever written by a search, so
      // the scan-time warm left it reading false while the model was loading —
      // and two more tools now publish it.
      embeddingWarming: this.embeddingProvider.isReady?.() === false,
      ...(this.lastLiteralWasExhaustive === undefined
        ? {}
        : { literalSearchStoppedEarly: !this.lastLiteralWasExhaustive }),
      ...(this.lastLiteralUnreadable.length > 0
        ? { literalUnreadableTools: [...this.lastLiteralUnreadable] }
        : {}),
    });
  }

  private countUnvectorizedUnits(): number {
    try {
      return countUnvectorizedUnits(this.getDb(), this.embeddingProvider.model);
    } catch {
      // Progress reporting must never be the thing that fails a tool call.
      return 0;
    }
  }

  /** Resolves when no scan is in flight. Used by close() and by tests. */
  async whenScanSettled(): Promise<void> {
    while (this.refreshPromise) {
      await this.refreshPromise.catch(() => {});
    }
  }

  private async refreshNow(): Promise<void> {
    const db = this.getDb();
    const startedAt = new Date().toISOString();
    const touchedSessions = new Set<string>();

    // First, not last: this repairs roll-ups a previous scan died before
    // reaching, and doing it up front means the repair survives even if this
    // scan is interrupted in the same way. Rows that already agree are not
    // written, so on a healthy index this costs one indexed count per session.
    this.prepared().reconcileSessionRollups.run();
    this.reconcileRetrievalUnits();

    for (const { scraper } of this.tools) {
      const scanned = await scanTool(scraper, {
        db,
        stmts: this.prepared(),
        scopedRoot: this.scopedRoot,
      });
      for (const sessionRef of scanned.touchedSessions) {
        touchedSessions.add(sessionRef);
      }
      this.scannedTools.add(scanned.tool);
    }

    for (const sessionRef of touchedSessions) {
      // Roll up message_count/preview once per touched session rather than
      // once per inserted message (which made indexing O(N²) per session).
      this.prepared().sessionRollup.run(sessionRef);
      this.rebuildRetrievalUnitsForSession(sessionRef);
    }

    setSetting(db, "last_scan_at", startedAt);
    setSetting(db, "last_scan_ms", String(Date.now() - Date.parse(startedAt)));

    // Warm vectors here too, not only inside a search.
    //
    // Vectorizing used to happen exclusively in `searchSessions`, where it is
    // capped so the caller is not left waiting. On a real corpus that means
    // about 80 searches — each paying the cap — before semantic search covers
    // the index, and an index nobody has searched yet reports zero vectors
    // against thousands of windows. A scan already runs in the background with
    // nobody waiting on it, which is the right place to spend the time.
    //
    // Same cap as a search, so this cannot become an unbounded CPU burn, and
    // failures are swallowed: warming is opportunistic, and a broken embedding
    // provider is already reported by the search path that depends on it.
    //
    // It does not finish quickly, and raising the cap would not change that:
    // embedding runs at roughly 1.3 windows a second here, so a cold
    // 1300-window index is about 17 minutes of CPU however it is spent — at
    // this cap, ~8 windows a scan. What makes that acceptable is the order:
    // `ensureVectors` takes the most recent windows first, so the history a
    // handoff actually reaches for is covered long before the archive is.
    // Only when the model is already loaded. Loading it is a one-off that can
    // take minutes on a cold cache and is not covered by the cap, and `close()`
    // waits for the scan — so warming through an unloaded model would turn
    // shutting the server down into a multi-minute hang. Start the load and
    // leave the vectors to the next scan instead.
    if (this.embeddingProvider.isReady?.() === false) {
      // Warm and *wait*, bounded — do not defer to "the next scan".
      //
      // There usually is no next scan. The CLI is spawned per MCP session and
      // exits shortly after the client disconnects, so `isReady()` is false at
      // the start of every process. Returning here meant vectorising never
      // happened at all: a real index sat at 0 vectors against 1,770 windows
      // for 25 days, reporting them as merely "outstanding" while semantic
      // search silently fell back to keyword on every query.
      //
      // The hazard the early return was protecting against is real and kept:
      // `close()` waits for the scan, so an unbounded load would turn shutting
      // the server down into a multi-minute hang on a cold model cache. The
      // wait is bounded rather than skipped, and a model that misses the
      // deadline keeps loading in the background for the next caller.
      this.embeddingProvider.warm?.();
      if (!(await waitUntilEmbeddingReady(this.embeddingProvider, this.embeddingWarmBudgetMs))) {
        return;
      }
    }

    try {
      await this.ensureVectors();
    } catch {
      // Nothing to do here — search reports embedding failures where they matter.
    }
  }

  /**
   * Rebuild retrieval units for sessions whose windows do not reach their last
   * message.
   *
   * Units are otherwise built only for the sessions a scan touched, at the end,
   * after every scraper — while each scraper advances its cursor as soon as it
   * finishes and the CLI exits shortly after a client disconnects. A scan that
   * dies in that gap leaves the messages committed, the cursor past them, and
   * the tail of the session in no window: reachable through
   * `xtctx_session_detail`, invisible to search, and never repaired because
   * nothing re-reads the store.
   *
   * `reconcileSessionRollups` above handles the same gap for `message_count`.
   * This is its counterpart, and the two run together for the same reason: at
   * the start, so the repair survives an interruption of the same kind.
   *
   * Bounded per scan. Rebuilding reads every message in a session, and scans
   * here are routinely cut short, so an unbounded pass over a large backlog
   * would spend the whole scan and be killed before finishing. Most-recently
   * active first, matching `ensureVectors`: the history a handoff reaches for
   * is covered before the archive is, and the backlog drains over a few scans.
   */
  private reconcileRetrievalUnits(): void {
    // Scoped to this project. One database can hold another project's
    // sessions — a copied `.xtctx/`, or a root that was renamed — and
    // rebuilding windows for those spends the scan's repair budget, and the
    // embedding that follows, on rows no read here will ever return.
    const drifted = this.prepared().selectSessionsMissingUnits.all(
      this.scopedRoot,
      RETRIEVAL_UNIT_RECONCILE_LIMIT,
    ) as Array<{ session_ref: string }>;

    for (const { session_ref: sessionRef } of drifted) {
      this.rebuildRetrievalUnitsForSession(sessionRef);
    }
  }

  private rebuildRetrievalUnitsForSession(sessionRef: string): void {
    const db = this.getDb();
    const stmts = this.prepared();
    const messages = stmts.selectSessionMessages.all(sessionRef) as MessageRow[];

    if (messages.length === 0) {
      db.prepare("DELETE FROM retrieval_units_fts WHERE session_ref = ?").run(sessionRef);
      db.prepare("DELETE FROM retrieval_units WHERE session_ref = ?").run(sessionRef);
      return;
    }

    const session = stmts.selectSessionTool.get(sessionRef) as { tool: string } | undefined;
    if (!session) {
      return;
    }

    // Diff the desired windows against what is stored instead of deleting
    // everything: unit ids are deterministic content hashes, so unchanged
    // windows (and, via the FK, their vectors) survive a re-index untouched.
    const now = new Date().toISOString();
    const desired = planRetrievalUnits(sessionRef, messages, this.windowSize, this.windowStride);

    const existing = new Set(
      (stmts.selectUnitIds.all(sessionRef) as Array<{ id: string }>).map((row) => row.id),
    );

    const stale = [...existing].filter((unitId) => !desired.has(unitId));

    const applyDiff = db.transaction(() => {
      // The FTS delete goes out once for the whole batch rather than once per
      // unit. `unit_id` is an UNINDEXED column of an FTS5 table, so every
      // delete against it scans the virtual table — measured at ~9ms across
      // 1,770 rows, which a rebuild of a few hundred units turns into seconds.
      // Batching makes that one scan instead of N. (The scan itself is
      // inherent to UNINDEXED columns; removing it needs an external-content
      // FTS keyed on rowid, which is a schema migration, not a patch.)
      if (stale.length > 0) {
        db.prepare(
          `DELETE FROM retrieval_units_fts WHERE unit_id IN (${placeholders(stale.length)})`,
        ).run(...stale);
      }
      for (const unitId of stale) {
        stmts.deleteUnit.run(unitId);
      }
      for (const [unitId, unit] of desired) {
        if (existing.has(unitId)) {
          continue;
        }
        stmts.insertUnit.run(
          unitId,
          sessionRef,
          session.tool,
          unit.start.message_index,
          unit.end.message_index,
          unit.start.timestamp,
          unit.end.timestamp,
          unit.content,
          unit.contentHash,
          now,
        );
        // Only the transcript text is keyword-indexed. `unit.content` also
        // carries the window scaffolding ("Session: …", "Turn 1/8 |
        // message_index=0 | user @ …") that gives the embedding model
        // ordering context; indexing it made `message_index` or a tool name
        // match every session.
        stmts.insertUnitFts.run(unitId, sessionRef, session.tool, unit.searchableText);
      }
    });
    applyDiff();
  }

  private prepared(): PreparedStatements {
    if (this.stmts) {
      return this.stmts;
    }

    this.stmts = prepareStatements(this.getDb());
    return this.stmts;
  }

  private async keywordSearch(
    query: string,
    limit: number,
    toolFilter?: string[],
    branchFilter?: string[],
  ): Promise<SessionSummary[]> {
    const rows = this.queryKeywordUnits(query, limit, toolFilter, branchFilter);
    // Rank by BM25 position so relevance, not recency, dominates ordering.
    return this.withDetailOffsets(
      groupUnits(rows, rankKeywordRows(rows), "keyword", normalizeLimit(limit, DEFAULT_LIMIT)),
    );
  }

  private async semanticSearch(
    query: string,
    limit: number,
    toolFilter: string[] | undefined,
    mode: Exclude<SessionSearchMode, "keyword">,
    branchFilter?: string[],
  ): Promise<SessionSummary[]> {
    const normalizedLimit = normalizeLimit(limit, DEFAULT_LIMIT);
    await this.ensureVectors(toolFilter);

    const db = this.getDb();
    const filters = normalizeToolFilter(toolFilter);
    const toolWhere = filters.length > 0 ? `AND u.tool IN (${placeholders(filters.length)})` : "";
    const branches = normalizeToolFilter(branchFilter);
    // Sessions with no recorded branch are excluded rather than assumed in:
    // no branch is not evidence of this branch.
    const branchWhere =
      branches.length > 0 ? `AND s.git_branch IN (${placeholders(branches.length)})` : "";
    const rows = db
      .prepare(
        `${retrievalUnitSelect()},
                v.vector,
                v.dimensions
         FROM retrieval_units u
         JOIN retrieval_unit_vectors v ON v.unit_id = u.id
         JOIN sessions s ON s.session_ref = u.session_ref
         WHERE v.model = ? AND ${PROJECT_ROOT_SQL.replace("project_root", "s.project_root")} = ?
               ${toolWhere} ${branchWhere}`,
      )
      .all(
        this.embeddingProvider.model,
        this.scopedRoot,
        ...filters,
        ...branches,
      ) as VectorUnitRow[];

    const keywordRows =
      mode === "hybrid" ? this.queryKeywordUnits(query, limit, toolFilter, branchFilter) : [];

    // Only needed to score vectors; skip the model entirely when there are none.
    const queryVector = rows.length > 0 ? await this.embeddingProvider.embed(query) : null;

    return this.withDetailOffsets(
      rankSearchCandidates({
        rows,
        keywordRows,
        queryVector,
        mode,
        limit: normalizedLimit,
        cosineSimilarity,
        deserializeVector,
        minSemanticCosine: this.minSemanticCosine,
        minConfidentCosine: this.minConfidentCosine,
      }),
    );
  }

  /**
   * Give every match the `offset` that actually reaches it.
   *
   * A window records the `message_index` values at its edges, and those are
   * not positions. `getSessionDetail` pages by position, so handing an agent
   * the index values — which is what the rendered `Match 5987-2108` was —
   * lands it wherever those numbers happen to fall. On a live index 430 of
   * 9,728 windows (4.4%) even had an end index BELOW their start, because one
   * session carried 828 duplicate messages and 862 disagreements between index
   * order and time order.
   *
   * Resolved on read rather than stored: the stored edges are part of a
   * window's id, so changing them would orphan every vector in every existing
   * index and cost each user a full re-embed — measured at 92 minutes on the
   * project that exposed this. At most three matches per session over five
   * sessions, each an indexed count, is the cheaper end of that trade.
   */
  private withDetailOffsets(sessions: SessionSummary[]): SessionSummary[] {
    for (const session of sessions) {
      for (const match of session.matches ?? []) {
        const offset = this.resolveDetailOffset(session.session_ref, match.message_start_index);
        if (offset !== null) {
          match.detail_offset = offset;
        }
      }
    }
    return sessions;
  }

  private resolveDetailOffset(sessionRef: string, messageIndex: number): number | null {
    try {
      const row = this.prepared().messageOffsetInSession.get(
        sessionRef,
        messageIndex,
        sessionRef,
      ) as { count: number } | undefined;
      return row?.count ?? null;
    } catch {
      // A pointer is an aid, not the answer: a session whose messages this
      // cannot locate still returns its match, preview and all. Failing the
      // whole search over a missing signpost would be the worse trade.
      return null;
    }
  }

  private queryKeywordUnits(
    query: string,
    limit: number,
    toolFilter?: string[],
    branchFilter?: string[],
  ): RetrievalUnitRow[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const db = this.getDb();
    const normalizedLimit = normalizeLimit(limit, DEFAULT_LIMIT);
    const filters = normalizeToolFilter(toolFilter);
    const toolWhere = filters.length > 0 ? `AND u.tool IN (${placeholders(filters.length)})` : "";
    const branches = normalizeToolFilter(branchFilter);
    // Sessions with no recorded branch are excluded rather than assumed in:
    // no branch is not evidence of this branch.
    const branchWhere =
      branches.length > 0 ? `AND s.git_branch IN (${placeholders(branches.length)})` : "";
    return db
      .prepare(
        `${retrievalUnitSelect()}
         FROM retrieval_units_fts f
         JOIN retrieval_units u ON u.id = f.unit_id
         JOIN sessions s ON s.session_ref = u.session_ref
         WHERE retrieval_units_fts MATCH ?
               AND ${PROJECT_ROOT_SQL.replace("project_root", "s.project_root")} = ?
               ${toolWhere} ${branchWhere}
         ORDER BY bm25(retrieval_units_fts), u.ended_at DESC
         LIMIT ?`,
      )
      .all(
        ftsQuery,
        this.scopedRoot,
        ...filters,
        ...branches,
        normalizedLimit * CANDIDATE_WINDOWS_PER_SESSION,
      ) as RetrievalUnitRow[];
  }

  /**
   * Embed every window that has no vector, with no time cap, and report
   * progress as it goes.
   *
   * Searches vectorize incrementally — six seconds per call, roughly sixteen
   * windows — on the reasoning that recall improves call over call and nobody
   * waits for the whole corpus. That holds at the scale it was designed
   * against and stops holding well before a real history: measured on a
   * 9,232-window project, an ordinary session would need on the order of 570
   * searches to finish, so semantic search there is keyword-only in practice
   * and every search pays the six seconds anyway.
   *
   * There is no daemon, so nothing works the backlog down between commands.
   * Two things call this: `xtctx scan --embed`, which runs it to completion
   * however long that takes, and the MCP server at session start, which runs
   * it only when this machine's measured rate says the remainder fits in a
   * budget. The bound is the whole point of the second caller — unconditional
   * background embedding is what would make a large project on a CPU
   * unusable.
   */
  /** See `SessionService.deferEmbeddingDeviceUntil`. */
  deferEmbeddingDeviceUntil(device: Promise<string | undefined>): void {
    const provider = this.embeddingProvider as {
      deferDeviceUntil?: (d: Promise<string | undefined>) => void;
    };
    provider.deferDeviceUntil?.(device);
  }

  async embedBacklog(onProgress?: (embedded: number, total: number) => void): Promise<number> {
    await this.whenScanSettled();
    // No `isReady` check and no degrading to keyword: `embedBatch` loads the
    // model itself and this command has nothing else it could be asking for,
    // so it waits however long that takes.
    //
    // A failure is recorded where `xtctx status` and `xtctx_continuity_status`
    // already look. The MCP server runs this in the background at startup with
    // nobody waiting on it, and its only caller used to swallow the error — so
    // an endpoint rejecting every call, or a model that could not load, left
    // the backlog frozen with no reason given anywhere.
    try {
      const remaining = await ensureVectors({
        db: this.getDb(),
        embeddingProvider: this.embeddingProvider,
        filters: [],
        vectorBudgetMs: 0,
        onProgress,
      });
      clearSetting(this.getDb(), "last_error:embeddings");
      return remaining;
    } catch (error) {
      setSetting(
        this.getDb(),
        "last_error:embeddings",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async ensureVectors(toolFilter?: string[]): Promise<void> {
    if (this.freezeVectors) {
      return;
    }
    this.vectorBacklog = await ensureVectors({
      db: this.getDb(),
      embeddingProvider: this.embeddingProvider,
      filters: normalizeToolFilter(toolFilter),
      vectorBudgetMs: this.vectorBudgetMs,
    });
  }

  private async initialize(): Promise<void> {
    if (!this.createIfMissing && !existsSync(this.dbPath)) {
      // Nothing to read and nothing to leave behind.
      this.db = openDatabase(":memory:");
      return;
    }

    await mkdir(dirname(this.dbPath), { recursive: true });
    try {
      await this.openAndPrepare();
    } catch (error) {
      // Only a file that is itself unusable -- corrupt, or from an OLDER
      // schema -- is set aside and a fresh one rebuilt from the transcript
      // stores. Set aside, not deleted: the index keeps sessions whose
      // transcripts are gone (Claude Code deletes them after 30 days by
      // default), so for those it is the only copy.
      //
      // Anything else stands, and the next call retries (see whenReady): a
      // lock held by another xtctx server is normal with one server per
      // client, and setting the file aside for it moved the live index out
      // from under the servers still writing to it on macOS and Linux, where
      // an open file can be renamed. A NEWER schema is refused rather than
      // set aside, so an older install cannot hide a newer one's history.
      const olderSchema = error instanceof SchemaVersionError && !error.newer;
      // Whatever was opened before the failure is closed: a retry opens a new
      // handle, and on Windows a leaked one also keeps the file locked.
      this.discardHandle();
      if (!olderSchema && !isCorruptDatabaseError(error)) {
        throw error;
      }
      await this.setDatabaseAside(error);
      try {
        await this.openAndPrepare();
      } catch (rebuildError) {
        this.discardHandle();
        throw rebuildError;
      }
    }
    if (this.closed) {
      this.discardHandle();
    }
  }

  /** Close and forget the handle, if one is open. */
  private discardHandle(): void {
    this.db?.close();
    this.db = null;
  }

  /**
   * Open the database and do the first reads and writes on it, inside the
   * same failure handling as the open itself: a file whose first page is fine
   * but whose data pages are damaged opens, and only fails here.
   */
  private async openAndPrepare(): Promise<void> {
    this.db = openDatabase(this.dbPath);

    // One rule covers every way the index can end up empty — deleted by a
    // user (the recovery the docs invite), rebuilt after corruption, or
    // wiped by hand: an empty index cannot honour a scraper cursor, because
    // the cursor would skip straight past history still sitting on disk.
    // On a genuine first run there are no cursor files, so this is a no-op.
    // Counted for *this* project, not for the file. An index shared with a
    // path this project no longer has — after a rename, a move, or a copied
    // `.xtctx/` — is empty as far as this project is concerned, and the
    // unscoped count made it look populated. The cursors were then honoured,
    // so the scan skipped the history that would have re-attributed those
    // sessions and the project stayed dark permanently.
    const sessionCount = countWhere(
      this.db,
      "sessions",
      `WHERE ${PROJECT_ROOT_SQL} = ?`,
      this.scopedRoot,
    );
    if (sessionCount === 0) {
      await this.clearScraperCursors();
    }

    dropVectorsFromOtherModels(this.getDb(), this.embeddingProvider.model);
  }

  /**
   * Resolves once the index is open. An open that failed for a reason that
   * says nothing about the file -- a lock, a permission, a full disk -- is
   * retried on the next call instead of failing every call for the life of
   * the server. A newer schema is final: retrying cannot change it.
   */
  private whenReady(): Promise<void> {
    const attempt = this.initialized;
    return attempt.catch((error: unknown) => {
      if (this.closed || (error instanceof SchemaVersionError && error.newer)) {
        throw error;
      }
      if (this.initialized === attempt) {
        this.initialized = this.initialize();
        this.initialized.catch(() => {});
      }
      return this.initialized;
    });
  }

  /**
   * Move the database and its WAL files to `xtctx.db.set-aside-<time>*`.
   * Throws `cause` if the main file cannot be moved, rather than deleting it.
   */
  private async setDatabaseAside(cause: unknown): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const aside = `${this.dbPath}.set-aside-${stamp}`;
    try {
      await rename(this.dbPath, aside);
    } catch {
      throw cause;
    }
    for (const suffix of ["-wal", "-shm"]) {
      await rename(`${this.dbPath}${suffix}`, `${aside}${suffix}`).catch(() => {});
    }
    process.stderr.write(
      `xtctx: the index at ${this.dbPath} could not be opened ` +
        `(${cause instanceof Error ? cause.message : String(cause)}); ` +
        `it was moved to ${aside} and a new one is being built.
`,
    );
  }

  /**
   * Drop every scraper's saved position so the next refresh re-scans from the
   * beginning. Called whenever the index is empty; see initialize().
   */
  private async clearScraperCursors(): Promise<void> {
    const stateDir = dirname(this.dbPath);
    try {
      for (const entry of await readdir(stateDir)) {
        if (entry.endsWith("-state.json")) {
          await rm(join(stateDir, entry), { force: true });
        }
      }
    } catch {
      // No state directory yet: nothing to reset.
    }
  }

  private getDb(): DatabaseHandle {
    if (!this.db) {
      throw new Error("xtctx handoff index is closed");
    }
    return this.db;
  }
}

function formatSessionRow(row: SessionRow): SessionSummary {
  return {
    session_ref: row.session_ref,
    tool: row.tool,
    started_at: row.started_at,
    last_activity_at: row.last_activity_at,
    message_count: row.message_count,
    preview: row.preview ?? undefined,
    source_path: row.source_path ?? undefined,
    git_branch: row.git_branch ?? undefined,
    git_commit: row.git_commit ?? undefined,
  };
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeSearchMode(value: SessionSearchMode): SessionSearchMode {
  return value === "keyword" || value === "vector" || value === "hybrid" || value === "literal"
    ? value
    : "hybrid";
}

function normalizeToolFilter(value?: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item) => typeof item === "string" && item.length > 0))];
}
