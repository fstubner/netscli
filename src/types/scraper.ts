export interface ChunkMetadata {
  messageIndex: number;
  tokenEstimate?: number;
  referencedFiles?: string[];
  /**
   * Chunking layer indicating the abstraction level of the content.
   *
   * - 0  Direct conversation turn (user ↔ assistant message). Default.
   * - 1  Compacted / summarized content (e.g. Codex compaction summaries,
   *      rule-based compaction output). Higher abstraction, fewer tokens.
   *
   * Consumers can prefer layer-0 for verbatim recall or layer-1 for
   * condensed context that spans more conversational history.
   */
  layer?: number;
  /**
   * The git branch and commit the session was actually working on.
   *
   * Taken from what the tool recorded in its own transcript, never from
   * asking git now. Indexing happens long after the session — often on a
   * different branch — so `git rev-parse` at index time would stamp today's
   * branch onto work done weeks ago, which is worse than recording nothing.
   *
   * Absent for tools that do not record it (antigravity, cursor, VS Code
   * Copilot). Nothing infers it.
   */
  gitBranch?: string;
  gitCommit?: string;
}

export interface ConversationChunk {
  tool: string;
  sessionId: string;
  timestamp: Date;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata: ChunkMetadata;
}

/**
 * State carried across a resume, because it is derived from records at the
 * start of a file that a resumed read never sees again.
 *
 * `messageIndex` and `projectMatched` are load-bearing rather than
 * conveniences: chunk ids hash the index, so restarting it would re-emit the
 * whole session under new ids, and `projectMatched` is set by the
 * `session_meta` and `turn_context` records at the head of the file, so
 * without it a resumed read attributes nothing and silently drops every
 * record it reads.
 */
export interface FileCursorContext {
  sessionId: string;
  messageIndex: number;
  projectMatched: boolean;
  approvalMode?: string;
  gitBranch?: string;
  gitCommit?: string;
  sandboxed?: boolean;
}

/** Where a previous scan stopped inside one append-only file. */
export interface FileCursor {
  /** Byte offset just past the last complete line consumed. */
  offset: number;
  /** File size when that offset was recorded; a smaller size means rewritten. */
  size: number;
  /**
   * Hash of the file's first bytes when the offset was recorded.
   *
   * Size alone cannot tell an append from a rewrite: a rewritten file that
   * happens to be as large as the old offset resumes mid-line and yields
   * garbage. An append never changes the head; a rewrite almost always does.
   */
  headHash?: string;
  /**
   * Hash of the bytes just before the offset, for a rewrite past the head;
   * see `fileTailHash`. Absent on short files, where the head covers it all.
   */
  tailHash?: string;
  /** Absent means resume is unsafe, so the file is read from the start. */
  context?: FileCursorContext;
  /**
   * The last chunk this file has yielded, across every read that led to this
   * cursor; null when it has yielded none.
   *
   * What lets the index check the cursor against what it actually holds. A
   * cursor at the end of a file says "everything before here is indexed",
   * and when that stops being true — rows lost to the concurrent prune this
   * field was added for, an index restored from a copy — nothing else ever
   * reads those lines again. Absent on cursors written before it existed,
   * which the check therefore cannot vouch for; see `useIndexProbe`.
   */
  lastEmitted?: EmittedPosition | null;
}

/** A chunk's place in its session: the two parts of its row the index can look up. */
export interface EmittedPosition {
  sessionId: string;
  messageIndex: number;
}

/**
 * Whether the index holds a row for this session at this position. Handed to
 * a scraper by the scan; see `ConversationScraper.useIndexProbe`.
 */
export type IndexProbe = (sessionId: string, messageIndex: number) => boolean;

export interface ScraperState {
  lastTimestamp: Date;
  lastOffset?: number;
  lastRowId?: number;
  checksum?: string;
  /**
   * Resume points for append-only transcript files, keyed by absolute path.
   *
   * A read optimisation only: what gets emitted is still decided by
   * `lastTimestamp` and each scraper's own filters. Losing this file costs a
   * full re-read, never correctness.
   */
  files?: Record<string, FileCursor>;
  /**
   * The version of the scraper's output that produced the rows already
   * indexed. Absent means the first version. A scraper whose output changed
   * for transcripts it has already read bumps its own constant, and a stored
   * value below it makes the next scan read everything again; see the
   * claude-code scraper.
   */
  scraperVersion?: number;
}

export interface ConversationScraper<
  T extends ConversationChunk = ConversationChunk,
> {
  readonly tool: string;
  detect(): Promise<boolean>;
  getStorePaths(): string[];
  scrape(since?: Date): AsyncIterable<T>;
  fullSync(): AsyncIterable<T>;
  getLastScrapedPosition(): Promise<ScraperState>;
  saveScrapedPosition(state: ScraperState): Promise<void>;
  /**
   * Optional. Lets a scraper that keeps per-file resume cursors check each one
   * against the index before trusting it: a cursor whose last yielded chunk is
   * not in the index is refused, and the file is read again from the start.
   * The scan installs a probe before scraping and removes it afterwards.
   */
  useIndexProbe?(probe: IndexProbe | undefined): void;
  /**
   * The ids (`ConversationChunk.sessionId`) of every session whose transcript
   * is in the store now, without reading any of them; null when the store
   * cannot be listed.
   *
   * Optional, for stores where that is a directory listing. `xtctx status`
   * uses it to count sessions the index holds the only copy of; a scraper
   * without it is left out of that count rather than guessed at.
   */
  listSessionIds?(): Promise<Set<string> | null>;
}

export interface ClaudeCodeChunk extends ConversationChunk {
  tool: "claude-code";
  metadata: ChunkMetadata & {
    toolCalls?: string[];
    costUsd?: number;
    sessionType: "interactive" | "headless";
    permissionMode?: string;
  };
}

export interface CursorChunk extends ConversationChunk {
  tool: "cursor";
  metadata: ChunkMetadata & {
    composerMode: "normal" | "agent";
    model: string;
    tabContext?: string[];
    codebaseSearchResults?: number;
    /**
     * Set on a conversation a parent agent started, whose first "user" turn
     * is that agent's prompt rather than anything the person typed.
     */
    subagent?: boolean;
    subagentType?: string;
  };
}

export interface CodexChunk extends ConversationChunk {
  tool: "codex";
  metadata: ChunkMetadata & {
    approvalMode: "suggest" | "auto-edit" | "full-auto";
    sandboxed: boolean;
    /** 0 = direct conversation turn; 1 = compacted/summary layer. */
    layer: number;
  };
}

export interface CopilotChunk extends ConversationChunk {
  tool: "copilot";
  metadata: ChunkMetadata & {
    model?: string;
    completionType?: string;
  };
}

export interface AntigravityChunk extends ConversationChunk {
  tool: "antigravity";
  metadata: ChunkMetadata & {
    artifactType?: string;
    artifactName?: string;
    summary?: string;
    sourcePath?: string;
    toolName?: string;
    model?: string;
  };
}

export interface OpenCodeChunk extends ConversationChunk {
  tool: "opencode";
  metadata: ChunkMetadata & {
    agent?: string;
    model?: string;
    providerID?: string;
  };
}

export interface CopilotCliChunk extends ConversationChunk {
  tool: "copilot-cli";
  metadata: ChunkMetadata & {
    eventType?: string;
    /**
     * Set on output from a subagent the main assistant launched, with the id of
     * the tool call that launched it.
     */
    subagent?: boolean;
    parentToolCallId?: string;
  };
}
