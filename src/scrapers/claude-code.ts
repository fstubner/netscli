import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChunkMetadata, ClaudeCodeChunk } from "../types/scraper.js";
import {
  AbstractScraper,
  describeType,
  emittedPosition,
  estimateTokens,
  fileSize,
  isRecord,
} from "./base.js";
import { encodePathForToolDirectory, pathMatchesProject } from "../utils/project-scope.js";
import { recordDrift, withDriftReport } from "./drift-log.js";
import { MAX_LINE_BYTES } from "./limits.js";
import { fileHeadHash, fileTailHash, resumeOffset } from "./base.js";
import { readJsonlLines } from "./jsonl-reader.js";
import type { EmittedPosition, FileCursor } from "../types/scraper.js";

const SCRAPER_NAME = "claude-code";

/**
 * Bumped when the scraper's output for a transcript it has already read
 * changes, so that already-indexed rows are corrected rather than kept.
 *
 * 1 (absent from state): `message.role` taken at face value, so tool results
 *    were indexed as role "user".
 * 2: tool results and tool-only assistant turns are role "tool"; tool calls
 *    are rendered; ANSI is stripped.
 *
 * Without this, the resume cursor sits past every finished session and the
 * old rows stay wrong until a transcript happens to grow. A stored version
 * below this ignores the cursors for one scan, which re-reads every
 * transcript still on disk through the normal path: the rows it writes carry
 * new ids (the id hashes the role), and the index's re-read prune then
 * deletes the old rows of each re-read session. Those rows were indexed
 * before the scan began, so the prune's bound to rows older than the scan
 * (see `pruneRereadSessions`) still reaches them. The cursors written by that
 * read carry `lastEmitted`, and the version is saved with them only once the
 * read has run to its end.
 *
 * Not the only thing that re-reads: a cursor the index no longer backs is
 * refused file by file (`cursorBackedByIndex`), and a schema migration
 * deletes the saved state outright, version included, which reads as this
 * version being outdated. Each forces at most one full read; none undoes
 * another.
 *
 * Sessions whose transcript files are gone are not re-read, so their rows
 * keep the old roles. They are the only copy of those sessions, which is why
 * this corrects in place instead of rebuilding the index.
 */
export const CLAUDE_CODE_SCRAPER_VERSION = 2;

/**
 * How many cwd-less records to hold while waiting for one that names a
 * project. Real files name one within the first few records; the cap only
 * bounds a pathological file that never does.
 */
const MAX_PENDING_UNATTRIBUTED = 500;

/**
 * Mutation shapes the claude-code scraper tolerates silently (no warn, no
 * throw). Everything else that falls outside the happy path warns.
 */
export const ACCEPTED_DEGRADATIONS = {
  /** Projects directory missing — Claude Code is simply not installed. */
  missingProjectsDir: "~/.claude/projects not present",
  /** A JSONL line that fails to parse — we skip but warn upstream. */
  malformedJsonlLine: "JSONL line is not valid JSON — warned, not fatal",
  /** Unknown sibling fields on a line (forward-compat for new keys). */
  unknownFieldsAlongside: "extra keys alongside known schema",
  /** Empty/blank lines in JSONL. */
  blankJsonlLine: "blank line inside JSONL file",
};

const ROLE_MAP: Record<string, ClaudeCodeChunk["role"]> = {
  human: "user",
  user: "user",
  assistant: "assistant",
  system: "system",
  tool_use: "tool",
  tool_result: "tool",
};

const NON_MESSAGE_TYPES = new Set([
  // `{"type":"atis-latch","atis":"","sessionId":"..."}` — bookkeeping, no
  // conversational content. Found by the format fingerprint the day Claude
  // Code started writing it, 18 in a single transcript.
  // A generated session title, alongside the user-set `custom-title` below.
  "ai-title",
  "atis-latch",
  "attachment",
  "custom-title",
  // A path/URL reference, alongside `pr-link` below.
  "frame-link",
  "last-prompt",
  // Session mode markers (`{"type":"mode","mode":"normal",…}`). Bookkeeping,
  // no conversational content — and frequent: 169 of them in a single
  // transcript here, each previously reported twice as drift.
  "mode",
  "pr-link",
  "progress",
  "queue-operation",
]);

export class ClaudeCodeScraper extends AbstractScraper<ClaudeCodeChunk> {
  readonly tool = SCRAPER_NAME;

  /** Resume points from the last scan; empty on a full sync. */
  private cursors: Record<string, FileCursor> = {};
  /** Resume points recorded by this scan. */
  private updatedCursors: Record<string, FileCursor> = {};
  /** False on a full sync, which neither resumes nor records. */
  private resuming = false;

  constructor(
    private readonly claudeProjectsDir: string,
    stateDir: string,
    private readonly projectRoot?: string,
    /**
     * The project's store directory, as stated by Claude Code rather than
     * reconstructed. Hooks receive a documented `transcript_path`, whose
     * directory this is; see `readAllSessions` for why that beats deriving it.
     */
    private readonly projectStoreDir?: string,
  ) {
    super(stateDir);
  }

  async detect(): Promise<boolean> {
    try {
      const dirStat = await stat(this.claudeProjectsDir);
      return dirStat.isDirectory();
    } catch {
      return false;
    }
  }

  getStorePaths(): string[] {
    return [this.claudeProjectsDir];
  }

  /**
   * Everything after each file's byte cursor, with no timestamp cutoff unless
   * one is passed.
   *
   * This used to default to the index's saved `lastTimestamp`. For an
   * append-only file the cursor already says exactly what is new, and the
   * timestamp only second-guessed it, wrongly in both directions it could:
   * a line appended with an earlier stamp than the newest one indexed was
   * skipped while the cursor moved past it, so no scan ever read it again;
   * and a file re-read from the top because it was rewritten had every
   * rewritten turn filtered out as old, so the index kept the text it had
   * replaced. A file with no usable cursor is read whole and its rows are
   * upserted by deterministic id, so the cost of not filtering is a re-read.
   */
  async *scrape(since?: Date): AsyncIterable<ClaudeCodeChunk> {
    const state = await this.getLastScrapedPosition();
    const outdated = (state.scraperVersion ?? 1) < CLAUDE_CODE_SCRAPER_VERSION;
    const cutoff = since ?? new Date(0);
    yield* withDriftReport(
      SCRAPER_NAME,
      this.readAllSessions(cutoff, true, outdated),
      this.stateDir,
    );
  }

  async *fullSync(): AsyncIterable<ClaudeCodeChunk> {
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(new Date(0)), this.stateDir);
  }

  parseRaw(raw: unknown): ClaudeCodeChunk {
    const obj = raw as Record<string, unknown>;
    const timestamp = parseRecordTimestamp(obj.timestamp);
    const content = extractContent(obj);
    const type = (obj.type as string) || "unknown";
    const role = extractRole(obj, type);

    return {
      tool: "claude-code",
      sessionId: (obj.sessionId as string) || "unknown",
      timestamp,
      role,
      content,
      metadata: {
        messageIndex: (obj.messageIndex as number) || 0,
        tokenEstimate: estimateTokens(content),
        referencedFiles: [],
        toolCalls: type === "tool_use" ? [(obj.name as string) || ""] : undefined,
        costUsd: obj.costUsd as number | undefined,
        // Recorded per record by Claude Code itself, so it is the branch the
        // work actually happened on rather than whatever is checked out now.
        gitBranch: toOptionalString(obj.gitBranch),
        sessionType: "interactive",
      } as ChunkMetadata & ClaudeCodeChunk["metadata"],
    };
  }

  /** See the codex scraper: `fullSync` neither resumes nor records. */
  private async *readAllSessions(
    since: Date,
    resume = false,
    outdated = false,
  ): AsyncIterable<ClaudeCodeChunk> {
    // An outdated state ignores its cursors, so every file is read from the
    // top. They are overwritten below once this read has finished.
    this.cursors = resume && !outdated ? ((await this.getLastScrapedPosition()).files ?? {}) : {};
    this.updatedCursors = {};
    this.resuming = resume;

    yield* this.readAllSessionsInner(since);

    // Reached only when the read ran to the end: a scan that throws abandons
    // the generator before this line, so an interrupted re-read does not mark
    // itself done and the next scan starts it again.
    if (resume && (outdated || Object.keys(this.updatedCursors).length > 0)) {
      // Merged by `saveScrapedPosition`, so this leaves the index's
      // `lastTimestamp` alone.
      await this.saveScrapedPosition({
        files: this.updatedCursors,
        scraperVersion: CLAUDE_CODE_SCRAPER_VERSION,
      });
    }
  }

  private async *readAllSessionsInner(since: Date): AsyncIterable<ClaudeCodeChunk> {
    // When the tool told us where its transcripts are, believe it.
    //
    // Reconstructing the location means re-implementing Claude Code's own path
    // encoding, which maps `:`, `\` and `/` all to `-` and so cannot be
    // inverted: `H:/projects/a` and `H:/projects-a` produce one directory
    // name. `CLAUDE_CONFIG_DIR` defeats it outright by moving the whole tree
    // somewhere the derived path never looks, and then xtctx reads nothing and
    // reports it as an empty history.
    //
    // A directory named by the tool is also better provenance than one we
    // guessed: nothing else can collide with it, so a record carrying no `cwd`
    // is safely ours.
    if (this.projectStoreDir) {
      yield* this.readProjectDir(this.projectStoreDir, since, true);
      return;
    }

    let projectDirs: string[];

    try {
      projectDirs = await readdir(this.claudeProjectsDir);
    } catch {
      // ACCEPTED_DEGRADATIONS.missingProjectsDir
      return;
    }

    const encodedProject = this.projectRoot
      ? encodePathForToolDirectory(this.projectRoot).toLowerCase()
      : null;

    yield* this.readProjects(projectDirs, encodedProject, since);
  }

  /**
   * Session ids are the transcript file names, as `readProjectDir` assigns
   * them, in the same directories it reads. Claude Code deletes transcripts
   * after 30 days by default, so this is what tells a session the index still
   * holds from one that also exists on disk.
   */
  async listSessionIds(): Promise<Set<string> | null> {
    let dirs: string[];
    if (this.projectStoreDir) {
      dirs = [this.projectStoreDir];
    } else {
      try {
        dirs = this.filterProjectDirs(await readdir(this.claudeProjectsDir)).map((dir) =>
          join(this.claudeProjectsDir, dir),
        );
      } catch {
        return null;
      }
    }

    const ids = new Set<string>();
    for (const dir of dirs) {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch (error) {
        // A project directory that is gone holds no transcripts; one that
        // cannot be read says nothing either way.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        return null;
      }
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          ids.add(file.replace(/\.jsonl$/, ""));
        }
      }
    }
    return ids;
  }

  private async *readProjects(
    projectDirs: string[],
    encodedProject: string | null,
    since: Date,
  ): AsyncIterable<ClaudeCodeChunk> {
    for (const projectHash of this.filterProjectDirs(projectDirs)) {
      const projectDir = join(this.claudeProjectsDir, projectHash);
      const exactDirectory =
        encodedProject === null || projectHash.toLowerCase() === encodedProject;
      yield* this.readProjectDir(projectDir, since, exactDirectory);
    }
  }

  private async *readProjectDir(
    projectDir: string,
    since: Date,
    exactDirectory: boolean,
  ): AsyncIterable<ClaudeCodeChunk> {
    {
      let files: string[];

      try {
        files = await readdir(projectDir);
      } catch {
        return;
      }

      for (const file of files) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }

        const sessionId = file.replace(/\.jsonl$/, "");
        const filePath = join(projectDir, file);
        try {
          yield* this.readSessionFile(filePath, sessionId, since, exactDirectory);
        } catch (err) {
          // One unreadable file must not abort the remaining files/projects.
          recordDrift(
            SCRAPER_NAME,
            filePath,
            `unreadable transcript file: ${(err as Error).message}`,
        );
        }
      }
    }
  }

  private async *readSessionFile(
    filePath: string,
    sessionId: string,
    since: Date,
    exactDirectory: boolean,
  ): AsyncIterable<ClaudeCodeChunk> {
    // Resume where the last scan stopped; see the codex scraper for why these
    // files are safe to resume and what refuses the cursor.
    const size = await fileSize(filePath);
    const saved = this.cursors[filePath];
    const cursor = saved && this.cursorBackedByIndex(saved) ? saved : undefined;
    const checkHash =
      this.resuming && cursor ? await fileHeadHash(filePath, cursor.offset) : null;
    const checkTail =
      this.resuming && cursor ? await fileTailHash(filePath, cursor.offset) : null;
    const startAt =
      size === null ? 0 : resumeOffset(cursor, size, checkHash ?? undefined, checkTail ?? undefined);
    if (size !== null && startAt > 0 && startAt >= size) {
      return;
    }

    const resumed = startAt > 0 ? cursor?.context : undefined;

    let messageIndex = resumed?.messageIndex ?? 0;
    // A byte offset, not a line number.
    //
    // A resumed read starts at `startAt` bytes, so a counter starting at zero
    // counts lines since the RESUME POINT: a record appended as line 101
    // reported as `path:1`, and a drift location is the only pointer anyone
    // has when chasing a format break. The offset is what the reader already
    // tracks and means the same thing on every pass.
    let byteAt = startAt;
    /**
     * null until a record in this file names a project.
     *
     * Carried across a resume: it is decided by `cwd` fields that a resumed
     * read never sees again, and getting it wrong means either dropping every
     * remaining record or attributing another project's to this one.
     */
    let fileIsOurs: boolean | null = resumed ? resumed.projectMatched : null;
    /** Records with no `cwd`, held until `fileIsOurs` is known. */
    const pending: ClaudeCodeChunk[] = [];
    let readTo = startAt;
    /** The last chunk handed out for this file; see `FileCursor.lastEmitted`. */
    let lastEmitted: EmittedPosition | null | undefined = resumed ? cursor?.lastEmitted : null;
    const emitted = (chunk: ClaudeCodeChunk | undefined): void => {
      lastEmitted = (chunk && emittedPosition(chunk)) ?? lastEmitted;
    };

    for await (const entry of readJsonlLines(filePath, { start: startAt })) {
      byteAt = entry.endOffset;
      readTo = entry.endOffset;
      const line = entry.line;
      if (line === null) {
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          `line exceeds ${MAX_LINE_BYTES} characters; skipped`,
        );
        continue;
      }
      if (!line.trim()) {
        continue;
      }

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch (err) {
        // ACCEPTED_DEGRADATIONS.malformedJsonlLine, but warn so the
        // mutation test can see drift instead of data silently vanishing.
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          `line is not valid JSON: ${(err as Error).message}`,
        );
        continue;
      }

      if (NON_MESSAGE_TYPES.has(String(obj.type)) && !carriesPlan(obj)) {
        continue;
      }

      // Ownership is decided per file, from the file's own records.
      //
      // The store directory cannot decide it: Claude Code encodes `:`, `\`
      // and `/` all to `-`, so `H:/projects/a` and `H:/projects-a` share one
      // directory. Treating an exact directory match as provenance therefore
      // handed one project the other's records — and 26% of real records carry
      // no `cwd`, so that was the common path, not an edge.
      //
      // A record that names its own `cwd` is unambiguous and also settles the
      // file: the rest of the file belongs wherever that one does.
      const recordCwd =
        typeof obj.cwd === "string" && obj.cwd.length > 0 ? obj.cwd : null;
      if (this.projectRoot && recordCwd) {
        const mine = pathMatchesProject(recordCwd, this.projectRoot);
        if (fileIsOurs === null) {
          fileIsOurs = mine;
          if (mine) {
            yield* pending;
            emitted(pending.at(-1));
          } else if (pending.length > 0) {
            recordDrift(
              SCRAPER_NAME,
              filePath,
              `${pending.length} record(s) without cwd dropped: this file belongs to ${recordCwd}`,
            );
          }
          pending.length = 0;
        }
        if (!mine) {
          continue;
        }
      } else if (this.projectRoot && fileIsOurs === false) {
        continue;
      }

      // Strict-mode schema check: warn (but still emit) on shape surprise.
      if (!("type" in obj)) {
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          "record is missing required 'type' field — likely renamed",
        );
      } else if (
        // A plan arrives as `type: "attachment"`, which is not in ROLE_MAP and
        // never will be — it is admitted deliberately by carriesPlan above, so
        // reporting it as an unknown type is noise about a known shape.
        !carriesPlan(obj) &&
        (typeof obj.type !== "string" || !(obj.type in ROLE_MAP))
      ) {
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          `unknown 'type' value ${JSON.stringify(obj.type)}`,
        );
      }

      if (
        "content" in obj &&
        obj.content !== undefined &&
        typeof obj.content !== "string"
      ) {
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          `expected 'content' to be a string, got ${describeType(obj.content)}`,
        );
      }

      if (!("timestamp" in obj)) {
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          "record is missing 'timestamp' field",
        );
      } else if (typeof obj.timestamp !== "string") {
        recordDrift(
          SCRAPER_NAME,
          `${filePath}@${byteAt}`,
          `expected 'timestamp' string, got ${describeType(obj.timestamp)}`,
        );
      }

      const timestamp = parseRecordTimestamp(obj.timestamp);

      // Every message-shaped record consumes an index, whether or not it is
      // emitted, so chunk identity is identical between full and incremental
      // scrapes (chunk ids hash the index).
      const currentIndex = messageIndex;
      messageIndex += 1;

      // A zero `since` means full sync: emit even epoch-sentinel timestamps.
      if (since.getTime() > 0 && timestamp <= since) {
        continue;
      }

      obj.sessionId = sessionId;
      obj.messageIndex = currentIndex;
      const chunk = this.parseRaw(obj);
      if (!chunk.content.trim()) {
        continue;
      }

      // Still no evidence either way: hold it until a record with a `cwd`
      // settles the file. The cap keeps a file that never names one from
      // growing this without bound; past it, fall back to the directory match,
      // which is all the old code ever had.
      if (this.projectRoot && fileIsOurs === null && !recordCwd) {
        if (pending.length < MAX_PENDING_UNATTRIBUTED) {
          pending.push(chunk);
          continue;
        }
        fileIsOurs = exactDirectory;
        if (!exactDirectory) {
          recordDrift(
            SCRAPER_NAME,
            filePath,
            `${pending.length} record(s) without cwd dropped: no record in this file names a project`,
          );
          pending.length = 0;
          continue;
        }
        yield* pending;
        emitted(pending.at(-1));
        pending.length = 0;
      }

      yield chunk;
      emitted(chunk);
    }

    // The file ended without any record naming a project. Nothing better than
    // the directory match is available, so use it — and say so when it drops
    // content, rather than losing it silently.
    if (pending.length > 0) {
      if (exactDirectory) {
        yield* pending;
        emitted(pending.at(-1));
      } else {
        recordDrift(
          SCRAPER_NAME,
          filePath,
          `${pending.length} record(s) without cwd dropped: no record in this file names a project`,
        );
      }
    }

    // Only once the file has been read through. `fileIsOurs` falls back to the
    // directory match, which is the decision this read actually applied to its
    // pending records — recording the undecided `null` would make the next
    // resume re-derive ownership from a point where no `cwd` is left to see.
    if (this.resuming && size !== null) {
      const headHash = await fileHeadHash(filePath, readTo);
      const tailHash = await fileTailHash(filePath, readTo);
      this.updatedCursors[filePath] = {
        offset: readTo,
        size,
        ...(headHash ? { headHash } : {}),
        ...(tailHash ? { tailHash } : {}),
        context: {
          sessionId,
          messageIndex,
          projectMatched: fileIsOurs ?? exactDirectory,
        },
        ...(lastEmitted === undefined ? {} : { lastEmitted }),
      };
    }
  }

  /**
   * Coarse pre-filter over encoded store directory names.
   *
   * Encoded names are ambiguous — `-` stands for `.`, `:`, `\`, `/` and `_`
   * alike — so
   * this only decides which directories are worth opening. Each record's own
   * `cwd` is what actually attributes it — the per-file ownership check in
   * `readSessionFile` — which
   * is both unambiguous and platform-independent. Keeping the prefix wide
   * here lets sessions started from a subdirectory through; the per-record
   * check then rejects a sibling like `<project>--secret`.
   */
  private filterProjectDirs(projectDirs: string[]): string[] {
    if (!this.projectRoot) {
      return projectDirs;
    }

    const encodedProject = encodePathForToolDirectory(this.projectRoot).toLowerCase();
    return projectDirs.filter((projectDir) => {
      const normalized = projectDir.toLowerCase();
      return normalized === encodedProject || normalized.startsWith(`${encodedProject}-`);
    });
  }

}

/**
 * Missing or unparseable timestamps become the epoch sentinel rather than an
 * Invalid Date, which would poison cutoff comparisons and toISOString().
 */
function parseRecordTimestamp(value: unknown): Date {
  const parsed = new Date((value as string) || 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function extractRole(
  obj: Record<string, unknown>,
  type: string,
): ClaudeCodeChunk["role"] {
  const message = isRecord(obj.message) ? obj.message : {};
  const role = typeof message.role === "string" ? message.role : type;
  const mapped = ROLE_MAP[role] ?? ROLE_MAP[type] ?? "system";

  // `message.role` is the API role, not who produced the words. Claude Code
  // writes every tool result back as a "user" record, so trusting the field
  // indexed 11,434 "user" messages against 5,325 "assistant" ones in a real
  // index, and the most common "user" texts were "File created successfully"
  // and "The file ... has been updated". A record carrying only tool blocks
  // is tool traffic whichever side of the API it sat on; one with real text
  // keeps its API role, because that text is what the person or model said.
  if ((mapped === "user" || mapped === "assistant") && Array.isArray(message.content)) {
    const blocks = message.content.filter(isRecord);
    const hasTool = blocks.some((b) => b.type === "tool_result" || b.type === "tool_use");
    const hasText = message.content.some(
      (b) => typeof b === "string" || (isRecord(b) && b.type !== "tool_result" && typeof b.text === "string"),
    );
    if (hasTool && !hasText) {
      return "tool";
    }
  }
  return mapped;
}

/**
 * Whether an otherwise-skipped record is a plan.
 *
 * `attachment` is in NON_MESSAGE_TYPES for good reason — most attachments are
 * pasted file contents, and indexing those would bury the conversation in
 * source code. But Claude Code also writes plans as attachments, with the plan
 * markdown in `attachment.planContent` and no `message` key at all, so the
 * blanket exclusion dropped every one: 11 records and 170,627 characters
 * across the transcripts on this machine, none of it retrievable.
 *
 * A plan is the decisions rather than the keystrokes, which makes it the most
 * worth retrieving thing in a session. Narrow on purpose: this admits records
 * carrying plan text and nothing else, so the file-dump attachments stay out.
 */
function carriesPlan(obj: Record<string, unknown>): boolean {
  const attachment = isRecord(obj.attachment) ? obj.attachment : undefined;
  return typeof attachment?.planContent === "string" && attachment.planContent.trim() !== "";
}

/**
 * Terminal colour and cursor sequences, which tool output carries and a
 * transcript has no use for: 726 real messages held them, and each one is
 * noise in search and an unreadable line in a handoff.
 */
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}

function extractContent(obj: Record<string, unknown>): string {
  return stripAnsi(extractRawContent(obj));
}

function extractRawContent(obj: Record<string, unknown>): string {
  if (typeof obj.content === "string") {
    return obj.content;
  }

  const message = isRecord(obj.message) ? obj.message : undefined;
  const fromMessage = message ? stringifyContent(message.content) : "";
  if (fromMessage.trim()) {
    return fromMessage;
  }

  // A plan record carries its text in `attachment.planContent` and nothing in
  // `message.content`, so reading only the latter produced an empty chunk that
  // the caller then dropped. Found by the format fingerprint, then measured
  // against real transcripts: 11 records, every one of them dropped, 170,627
  // characters — and a plan is the single most retrievable thing in a
  // session, being the decisions rather than the keystrokes.
  const attachment = isRecord(obj.attachment) ? obj.attachment : undefined;
  if (attachment && typeof attachment.planContent === "string") {
    return attachment.planContent;
  }

  return fromMessage;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  // A record that mixes real text with tool results keeps the text only, and
  // stays one chunk: chunk ids hash `messageIndex`, so splitting a record in
  // two would renumber every later message. The results are tool output the
  // person never wrote, and the pure-result records (the real shape) are
  // indexed whole as role "tool" by extractRole.
  const hasText = value.some(
    (item) => typeof item === "string" || (isRecord(item) && typeof item.text === "string"),
  );

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!isRecord(item)) {
        return "";
      }
      if (item.type === "tool_use") {
        return describeToolUse(item);
      }
      if (item.type === "tool_result") {
        return hasText ? "" : toolResultText(item.content);
      }
      if (typeof item.text === "string") {
        return item.text;
      }
      if (typeof item.content === "string") {
        return item.content;
      }
      return "";
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

/** A tool result's content is a string, or an array of text blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter((part) => part.length > 0)
    .join("\n");
}

const TOOL_LINE_MAX = 200;

/**
 * One short line for a tool call: `ran Bash: <command>`, `edit <path>`.
 *
 * The call was dropped entirely, so an assistant turn that only ran tools left
 * no trace of what it did. The input is never indexed whole: a Write carries
 * the entire file and an Edit both versions of it.
 */
function describeToolUse(block: Record<string, unknown>): string {
  const name = typeof block.name === "string" && block.name ? block.name : "tool";
  const input = isRecord(block.input) ? block.input : {};
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim().split(/\r?\n/, 1)[0] ?? "";
      }
    }
    return "";
  };

  let line: string;
  if (name === "Bash") {
    line = `ran Bash: ${pick("command")}`;
  } else if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
    line = `edit ${pick("file_path", "notebook_path")}`;
  } else if (name === "Write") {
    line = `write ${pick("file_path")}`;
  } else if (name === "Read") {
    line = `read ${pick("file_path")}`;
  } else {
    const hint = pick("file_path", "path", "pattern", "command", "url", "query", "description");
    line = hint ? `used ${name}: ${hint}` : `used ${name}`;
  }
  line = line.trim();
  return line.length > TOOL_LINE_MAX ? `${line.slice(0, TOOL_LINE_MAX)}…` : line;
}

/** A non-empty string, or nothing. An empty branch is no branch. */
function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
