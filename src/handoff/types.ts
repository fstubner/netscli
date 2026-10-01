export interface SessionSummary {
  session_ref: string;
  tool: string;
  started_at: string;
  last_activity_at: string;
  message_count: number;
  preview?: string;
  source_path?: string;
  /**
   * The branch and commit the session ran on, as the tool recorded them at the
   * time. Absent for tools that do not record it; never inferred from the
   * working tree at index time, which would be a different branch entirely.
   */
  git_branch?: string;
  git_commit?: string;
  score?: number;
  retrieval?: SessionSearchMode;
  matches?: RetrievalMatch[];
}

export interface SessionMessage {
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  source_pointer?: string;
  /**
   * 0-based position in the session's message order — the same number
   * `offset` counts from the start, so a caller who has read the end can
   * ask for the page before it.
   */
  position?: number;
}

export interface HandoffStatus {
  project_root: string;
  db_path: string;
  last_scan_at: string | null;
  /**
   * How long the last scan took, in milliseconds.
   *
   * `last_scan_at` says when the index was last refreshed but not what that
   * cost, so there was no way to tell a scan that finished in a second from
   * one that ran out its budget and left work behind.
   */
  last_scan_ms: number | null;
  sessions: number;
  messages: number;
  retrieval_units: number;
  vectorized_units: number;
  /**
   * Milliseconds per window in the last vectorizing pass.
   *
   * With `retrieval_units` and `vectorized_units` this turns a backlog into a
   * duration: the remaining windows times this is roughly the embedding left
   * to do. Null until a pass has run.
   */
  vector_ms_per_unit: number | null;
  /**
   * Segments the outstanding windows will be split into, and milliseconds per
   * segment from the last pass.
   *
   * The estimate is built from these rather than from window counts. A window
   * is split into up to sixteen segments and each is its own pass through the
   * model, so windows differ in cost by more than an order of magnitude —
   * a real pass averaged 391ms/window over its first half and 854ms/window
   * overall. Segments are capped in size, so their cost is roughly uniform.
   */
  vector_segment_backlog: number;
  vector_ms_per_segment: number | null;
  vector_model: string;
  /**
   * How semantic search is answered here.
   *
   * `off` is the default for a fresh install: the local model is an add-on
   * (`xtctx embeddings enable`), and until it is installed every search is
   * keyword-only, by design rather than by failure. `remote` is an
   * OpenAI-compatible endpoint, which needs no local runtime.
   */
  semantic_search: "local" | "remote" | "off";
  /** Why `semantic_search` is off, or null when it is not. */
  semantic_off_reason: "not_enabled" | "disabled_by_env" | null;
  /**
   * ONNX execution provider embedding actually runs on, or null when this
   * machine has not been calibrated and is therefore on the CPU default.
   *
   * Reported because it is otherwise invisible: `xtctx calibrate` writing a
   * verdict and the indexer using it are two different things, and a verdict
   * that is recorded but never read looks exactly like one that works.
   */
  vector_device: string | null;
  /** Last semantic-search failure, or null. Non-null means hybrid search is
   *  silently answering from keyword only. */
  embedding_error: string | null;
  /**
   * Enabled tools whose transcript store this project's `.xtctx/config.yaml`
   * points outside the home directory.
   *
   * That file is committable, so a cloned repository can carry one — and a
   * redirected store means the transcripts served as this project's context
   * came from somewhere else. Tool names only: the paths themselves carry the
   * machine's home-directory layout and are redacted from model-facing
   * surfaces.
   */
  redirected_tools: string[];
  /**
   * This project's sessions whose transcript is no longer where its tool
   * keeps them, so the index holds the only copy and deleting it loses them.
   *
   * Counted only for tools whose scraper can list the sessions on disk
   * (`ConversationScraper.listSessionIds`) — Claude Code, which deletes
   * transcripts after 30 days by default. A tool that cannot say contributes
   * nothing rather than a guess, so this is a floor, never an overcount.
   */
  index_only_sessions: number;
  tools: Array<{
    tool: string;
    detected: boolean;
    last_error: string | null;
    store_paths: string[];
    indexed_sessions: number;
    indexed_messages: number;
    last_indexed_at: string | null;
  }>;
}

export interface SessionService {
  listRecentSessions(
    limit: number,
    toolFilter?: string[],
    branchFilter?: string[],
  ): Promise<SessionSummary[]>;
  getSessionByRef(sessionRef: string): Promise<SessionSummary | null>;
  /**
   * `fromEnd` counts `offset` back from the newest message instead of
   * forward from the oldest; either way the page comes back oldest-first.
   */
  getSessionDetail(
    sessionRef: string,
    offset: number,
    limit: number,
    fromEnd?: boolean,
  ): Promise<SessionMessage[]>;
  searchSessions(
    query: string,
    limit: number,
    toolFilter?: string[],
    mode?: SessionSearchMode,
    branchFilter?: string[],
  ): Promise<SessionSummary[]>;
  getStatus(): Promise<HandoffStatus>;
  close(): Promise<void>;
  /**
   * What the last answer did not include, if anything.
   *
   * Scanning and vectorizing are both bounded per call so an agent is never
   * left waiting on the whole machine's history. That makes an answer capable
   * of being incomplete, and an incomplete answer presented as a complete one
   * is the worse failure — the agent concludes the history is not there.
   */
  getIndexProgress?(): IndexProgress;
  /**
   * Recent sessions from the index as it already stands, without scanning.
   *
   * `listRecentSessions` will start a scan of every transcript store on the
   * machine and wait several seconds for it. That is the right trade inside a
   * tool call the agent is already waiting on, and the wrong one in the
   * SessionStart hook, which runs before the user's first turn and would add
   * that delay to every agent startup.
   */
  listIndexedSessions?(limit: number): Promise<SessionSummary[]>;
  /**
   * Resolves once no scan is in flight.
   *
   * Serving a tool call deliberately stops waiting for the scan and lets it
   * finish in the background, so a caller that needs the *complete* index —
   * shutdown, or a test asserting that every tool was picked up — has to be
   * able to say so. Without this the only way to wait is to guess a duration,
   * which is a race dressed up as a test.
   *
   * Required rather than optional: callers had to write `whenScanSettled?.()`,
   * which silently does nothing when the method is absent. The one caller that
   * matters is the cross-tool smoke test, and "silently did not wait" is
   * exactly the failure it exists to catch. An implementation with no scan to
   * wait for returns an already-resolved promise.
   */
  whenScanSettled(): Promise<void>;
  /**
   * Embed every window with no vector, with no time cap.
   *
   * Optional because only `xtctx scan --embed` needs it: searches vectorize a
   * few seconds at a time, which never finishes a large history — nothing runs
   * between commands to work the backlog down.
   */
  embedBacklog?(onProgress?: (embedded: number, total: number) => void): Promise<number>;
  /**
   * Write this project's sessions and messages as an export file, a line at a
   * time; see `export-file.ts` for the format. Reads the index as it stands,
   * without scanning, and never touches a transcript.
   *
   * Optional because only `xtctx export` needs it, like `embedBacklog`.
   */
  exportSessions?(
    writeLine: (line: string) => Promise<void>,
    options?: { xtctxVersion?: string },
  ): Promise<ExportSummary>;
  /** Merge an export file's lines into this project's index; see `exportSessions`. */
  importSessions?(lines: AsyncIterable<string>): Promise<ImportSummary>;
  /**
   * Make the embedding model's first load wait for this device.
   *
   * For calibration running alongside the index: whichever caller asks for the
   * model first gets a load that waits for the verdict, so the session that
   * measured the device is the one that uses it.
   */
  deferEmbeddingDeviceUntil?(device: Promise<string | undefined>): void;
}

export interface ExportSummary {
  sessions: number;
  messages: number;
}

export interface ImportSummary {
  /** Session lines read from the file, valid or not. */
  sessionsInFile: number;
  /** Sessions the index did not have. */
  sessionsAdded: number;
  /** Sessions it had, which gained messages from the file. */
  sessionsUpdated: number;
  /** Sessions it already held in full. */
  sessionsUnchanged: number;
  messagesAdded: number;
  /** Lines skipped because they were not a whole, valid line, and why. */
  invalidLines: Array<{ line: number; reason: string }>;
  /**
   * The file ended with its end line, and that line's session count matched.
   * False means it was cut short: what it held was imported, and nothing
   * after the cut can have been.
   */
  complete: boolean;
}

export interface IndexProgress {
  /** A scan started by an earlier call is still running. */
  scanning: boolean;
  /** Windows indexed but not yet vectorized, so semantic recall is partial. */
  vectorBacklog: number;
  /** The embedding model is still loading, so this answer is keyword-only. */
  embeddingWarming: boolean;
  /**
   * The last literal search hit its limit or its time budget before reading
   * every store, so "no more matches" is not what it found.
   *
   * Set by a search rather than by the index, because the literal route reads
   * the stores directly and has no index state to report. Absent until one has
   * run in this process.
   */
  literalSearchStoppedEarly?: boolean;
  /**
   * Tools whose transcript store threw during the last literal pass.
   *
   * Reported separately from the flag above because the remedies are
   * opposite. A pass that hit its limit finds more if the query is narrowed;
   * a store that cannot be read yields nothing however the query is written,
   * and telling the caller to narrow it sends them round a loop that cannot
   * end.
   */
  literalUnreadableTools?: string[];
  /**
   * Tools whose transcript store has not been read yet in this process.
   *
   * Named individually because "still scanning" does not tell a caller
   * whether the tool it is asking about is among those already read — an
   * answer missing a whole tool looks exactly like an answer with nothing to
   * report.
   */
  unreadTools: string[];
}

/**
 * How a search was answered.
 *
 * `literal` is the one that does not read the index: it streams the transcript
 * stores and matches text directly, so it can answer before a scan has
 * finished. See `handoff/literal-search.ts`.
 */
export type SessionSearchMode = "hybrid" | "keyword" | "vector" | "literal";

export interface RetrievalMatch {
  unit_id: string;
  message_start_index: number;
  message_end_index: number;
  started_at: string;
  ended_at: string;
  preview: string;
  /**
   * The `offset` to pass to `xtctx_session_detail` to land on this match.
   *
   * Not the same number as `message_start_index`, and that difference is the
   * bug this exists to fix. Detail pages by POSITION in the session's
   * timestamp ordering; a window records the `message_index` VALUES at its
   * edges. The two agree only while numbering is dense and monotonic in time
   * order, which real transcripts are not — measured on one live index, 430 of
   * 9,728 windows (4.4%) had an end index BELOW their start, and following the
   * rendered range as an offset landed three weeks away from the match.
   *
   * Absent for a literal match, which has no indexed session to page through.
   */
  detail_offset?: number;
  /**
   * How similar this window is to the query, on the same absolute scale as the
   * session's score. Absent for keyword-only matches, whose keyword score is
   * reciprocal rank — the top hit is 1.0 whatever it matched.
   */
  score?: number;
  semantic_score?: number;
  keyword_score?: number;
  /**
   * The ranking components, when the route ranked at all. Absent for a literal
   * match: that route reads the stores in the order it finds them and does not
   * score, and reporting 0 would read as "least recent" rather than "not
   * measured".
   */
  recency_score?: number;
  continuity_score?: number;
}
