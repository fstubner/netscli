import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CopilotCliChunk } from "../types/scraper.js";
import { pathMatchesProject } from "../utils/project-scope.js";
import {
  AbstractScraper,
  describeType,
  driftWarner,
  emittedPosition,
  estimateTokens,
  fileSize,
  isRecord,
  toDate,
} from "./base.js";
import { withDriftReport } from "./drift-log.js";
import { fileHeadHash, fileTailHash, resumeOffset } from "./base.js";
import { readJsonlLines } from "./jsonl-reader.js";
import type { EmittedPosition, FileCursor } from "../types/scraper.js";

const SCRAPER_NAME = "copilot-cli";

/**
 * Bumped when the scraper's output for a session it has already read changes,
 * so that already-indexed rows are corrected rather than kept. Same mechanism
 * as `CLAUDE_CODE_SCRAPER_VERSION`.
 *
 * 1 (absent from state): subagent output indexed as ordinary assistant turns,
 *    the CLI's own system prompt indexed as a turn, tool executions dropped.
 * 2: subagent output is role "tool" with `subagent` metadata, `system.message`
 *    is skipped, and each tool execution is a one-line "tool" chunk.
 *
 * A stored version below this ignores the cursors for one scan, which
 * re-reads every session still on disk through the normal path: the rows
 * it writes carry new ids (the id hashes role, index and content) and the
 * index's re-read prune then deletes the old rows of each re-read session.
 * Sessions whose files are gone keep their old rows, being the only copy.
 */
export const COPILOT_CLI_SCRAPER_VERSION = 2;

/** Longest tool line kept; a command or pattern can be arbitrarily long. */
const MAX_TOOL_LINE = 200;

/**
 * Mutation shapes the copilot-cli scraper tolerates silently. Anything
 * outside this whitelist that drops records must warn.
 */
export const ACCEPTED_DEGRADATIONS = {
  /** Sessions root missing — Copilot CLI not installed. */
  missingSessionRoot: "~/.copilot/session-state directory absent",
  /** Session directory has no events.jsonl file yet — fresh session. */
  missingEventsJsonl: "session directory has no events.jsonl",
  /** Blank line in events.jsonl. */
  blankJsonlLine: "blank line in events.jsonl",
  /** Event with no extractable role — many event types (status, turn
   *  boundaries, subagent meta, etc.) legitimately have no role. */
  noRole: "event has no role — non-conversation event",
  /** Event with no extractable text content. */
  noContent: "event has role but no text content",
  /** Forward-compat unknown keys alongside known fields. */
  unknownFieldsAlongside: "extra keys alongside known event schema",
};

const ROLE_MAP: Record<string, CopilotCliChunk["role"]> = {
  user: "user",
  human: "user",
  assistant: "assistant",
  ai: "assistant",
  system: "system",
  tool: "tool",
};

/**
 * Current Copilot CLI writes typed events ("user.message",
 * "assistant.message") whose payload lives under `data`. The event type itself
 * carries the role. "system.message" is the CLI's own system prompt and is
 * skipped rather than mapped.
 */
const EVENT_TYPE_ROLE_MAP: Record<string, CopilotCliChunk["role"]> = {
  "user.message": "user",
  "assistant.message": "assistant",
};

/**
 * Event types that carry a `data.content` payload but are not conversation.
 *
 * `data.content` is otherwise a reliable sign that a record holds a turn — of
 * the sixteen types a real store emits, only the two routed above, the system
 * prompt (skipped in the read loop) and this one carry it. Listing it is what lets an unrecognised type carrying that
 * payload be reported as drift without warning on every scan for something
 * deliberately skipped.
 */
const KNOWN_NON_CONVERSATION_TYPES = new Set(["system.notification"]);

const warnDrift = driftWarner(SCRAPER_NAME);

export class CopilotCliScraper extends AbstractScraper<CopilotCliChunk> {
  /** Resume points from the last scan; empty on a full sync. */
  private cursors: Record<string, FileCursor> = {};
  private updatedCursors: Record<string, FileCursor> = {};
  private resuming = false;

  readonly tool = SCRAPER_NAME;

  constructor(
    private readonly sessionStateDir: string,
    stateDir: string,
    private readonly projectRoot?: string,
  ) {
    super(stateDir);
  }

  async detect(): Promise<boolean> {
    try {
      const target = await stat(this.sessionStateDir);
      return target.isDirectory();
    } catch {
      return false;
    }
  }

  getStorePaths(): string[] {
    return [this.sessionStateDir];
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
  async *scrape(since?: Date): AsyncIterable<CopilotCliChunk> {
    const state = await this.getLastScrapedPosition();
    const outdated = (state.scraperVersion ?? 1) < COPILOT_CLI_SCRAPER_VERSION;
    const cutoff = since ?? new Date(0);
    yield* withDriftReport(
      SCRAPER_NAME,
      this.readAllSessions(cutoff, true, outdated),
      this.stateDir,
    );
  }

  async *fullSync(): AsyncIterable<CopilotCliChunk> {
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(new Date(0)), this.stateDir);
  }

  /** See the codex scraper: `fullSync` neither resumes nor records. */
  private async *readAllSessions(
    since: Date,
    resume = false,
    outdated = false,
  ): AsyncIterable<CopilotCliChunk> {
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
      await this.saveScrapedPosition({
        files: this.updatedCursors,
        scraperVersion: COPILOT_CLI_SCRAPER_VERSION,
      });
    }
  }

  private async *readAllSessionsInner(since: Date): AsyncIterable<CopilotCliChunk> {
    let sessionDirs: string[];
    try {
      sessionDirs = await readdir(this.sessionStateDir);
    } catch {
      // ACCEPTED_DEGRADATIONS.missingSessionRoot
      return;
    }

    for (const sessionId of sessionDirs) {
      const sessionDir = join(this.sessionStateDir, sessionId);
      let dirStat;
      try {
        dirStat = await stat(sessionDir);
      } catch {
        continue;
      }
      if (!dirStat.isDirectory()) continue;

      const eventsPath = join(sessionDir, "events.jsonl");
      try {
        const eventsStat = await stat(eventsPath);
        if (!eventsStat.isFile()) continue;
      } catch {
        // ACCEPTED_DEGRADATIONS.missingEventsJsonl
        continue;
      }

      try {
        yield* this.readEventsFile(eventsPath, sessionId, since);
      } catch (err) {
        // One unreadable session must not abort the remaining sessions.
        warnDrift(eventsPath, `unreadable transcript file: ${(err as Error).message}`);
      }
    }
  }

  private async *readEventsFile(
    filePath: string,
    sessionId: string,
    since: Date,
  ): AsyncIterable<CopilotCliChunk> {
    // Resume where the last scan stopped; see the codex scraper for the guards.
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
    // null = no session.start context seen yet; only consulted when scoped.
    // Carried across a resume: it is set by the `session.start` record at the
    // head of the file, which a resumed read never sees again.
    let projectMatch: boolean | null = resumed ? resumed.projectMatched : null;
    let gitBranch: string | undefined = resumed?.gitBranch;
    let gitCommit: string | undefined = resumed?.gitCommit;
    let readTo = startAt;
    /** The last chunk handed out for this file; see `FileCursor.lastEmitted`. */
    let lastEmitted: EmittedPosition | null | undefined = resumed ? cursor?.lastEmitted : null;

    for await (const entry of readJsonlLines(filePath, { start: startAt })) {
      byteAt = entry.endOffset;
      readTo = entry.endOffset;
      const line = entry.line;
      if (line === null) {
        warnDrift(filePath, `line exceeds the cap; skipped`);
        continue;
      }
      if (!line.trim()) {
        // ACCEPTED_DEGRADATIONS.blankJsonlLine
        continue;
      }

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch (err) {
        warnDrift(
          `${filePath}@${byteAt}`,
          `events.jsonl line is not valid JSON: ${(err as Error).message}`,
        );
        continue;
      }

      if (!isRecord(event)) {
        warnDrift(
          `${filePath}@${byteAt}`,
          `events.jsonl line is not an object (got ${describeType(event)})`,
        );
        continue;
      }

      if (event.type === "session.start") {
        // Recorded by the CLI at session start, so it is the branch the work
        // happened on rather than whatever is checked out at index time.
        const context = isRecord(event.data) ? event.data.context : undefined;
        if (isRecord(context)) {
          gitBranch = toOptionalString(context.branch);
          gitCommit = toOptionalString(context.headCommit);
        }
      }

      if (this.projectRoot && event.type === "session.start") {
        projectMatch = sessionStartMatchesProject(event, this.projectRoot);
        if (projectMatch === false) {
          // Another project's session; nothing in this file belongs here.
          return;
        }
        continue;
      }

      // The CLI's own system prompt: instructions to the model, not anything
      // the user or the assistant said.
      if (event.type === "system.message") {
        continue;
      }

      // A tool execution has no text of its own; it is recorded as one line.
      // Handled ahead of the role check so that it goes through the same
      // project-scope guard and timestamp cutoff as every other record.
      const toolText =
        event.type === "tool.execution_start" ? describeToolExecution(event) : undefined;
      const parentToolCallId =
        isRecord(event.data) && typeof event.data.parentToolCallId === "string"
          ? event.data.parentToolCallId
          : undefined;

      let role = toolText ? "tool" : extractRole(event);
      const content = toolText ?? extractContent(event);
      // Output carrying a `parentToolCallId` came from a subagent the main
      // assistant launched. Presented as an assistant turn it reads as the main
      // assistant speaking, so it is filed as tool output.
      if (parentToolCallId && role === "assistant") {
        role = "tool";
      }

      if (!role) {
        // If the event looks like a conversation message (has extractable
        // content AND a 'message' or 'role'-shaped sibling that we COULDN'T
        // route), warn — likely a rename. Routine non-conversation events
        // (status, tool_call, etc.) carry no content and are silent.
        if (content) {
          // `data.content` is where a turn's text lives, so a record carrying
          // it that could not be routed has lost its type — which is what a
          // renamed `type` field looks like, and it took every turn in the
          // session with it. The three legacy markers below could not see
          // that: none of them appear in the format Copilot CLI now writes.
          const carriesTurnText =
            isRecord(event.data) &&
            typeof event.data.content === "string" &&
            !KNOWN_NON_CONVERSATION_TYPES.has(String(event.type));
          const looksLikeMessage =
            carriesTurnText ||
            event.type === "message" ||
            "role" in event ||
            (isRecord(event.message) && "role" in event.message);
          if (looksLikeMessage) {
            warnDrift(
              `${filePath}@${byteAt}`,
              "event has content but no readable role — likely role-field rename",
            );
          }
        }
        // ACCEPTED_DEGRADATIONS.noRole — non-conversation events are
        // routine in events.jsonl. Skip silently.
        continue;
      }

      if (!content) {
        // Role is present but no content extractable. If a 'content' key
        // exists in an unexpected shape (null, number, etc.), warn — silent
        // skip would hide a content-field retype. A genuinely-missing content
        // key on a role'd event is unusual but not necessarily drift.
        if ("content" in event && typeof event.content !== "string" && !Array.isArray(event.content)) {
          warnDrift(
            `${filePath}@${byteAt}`,
            `event has role but 'content' is unexpected type ${describeType(event.content)}`,
          );
        } else if (
          // The same check for where the text actually lives in the current
          // format. Only the legacy top-level key was examined, so a
          // `data.content` that turned null dropped the turn in silence — and
          // `data.content` is the field every real turn uses.
          isRecord(event.data) &&
          "content" in event.data &&
          typeof event.data.content !== "string" &&
          !Array.isArray(event.data.content)
        ) {
          warnDrift(
            `${filePath}@${byteAt}`,
            `event has role but 'data.content' is unexpected type ${describeType(event.data.content)}`,
          );
        } else if (
          typeof event.type === "string" &&
          event.type in EVENT_TYPE_ROLE_MAP &&
          !isRecord(event.data)
        ) {
          // A turn-typed event with no payload object at all. Nothing narrower
          // catches a payload that moved wholesale — with `data` gone there is
          // no field left to find surprising, and the turn vanished silently.
          //
          // The `data` check is what keeps this honest: 77 assistant.message
          // records in one real session carry a `data` holding a tool call and
          // no text, which is ordinary. Warning on "no readable content" alone
          // reported all of them as drift on the first live scan.
          warnDrift(
            `${filePath}@${byteAt}`,
            `${event.type} has no 'data' payload — the field may have been renamed`,
          );
        }
        // ACCEPTED_DEGRADATIONS.noContent
        continue;
      }

      if (this.projectRoot && projectMatch !== true) {
        // Fail closed on anything that is not an explicit match. This used to
        // test `=== null`, which is every state a *fresh* pass can be in —
        // a rejected `session.start` returns before reaching here. A resumed
        // pass can restore `false` from the cursor, and that has to refuse
        // too, or the cursor becomes a way to smuggle a decision past the
        // check that exists to make it.
        warnDrift(
          filePath,
          "session has no session.start context; cannot attribute to a project — skipped under project scoping",
        );
        return;
      }

      const tsValue = event.timestamp ?? event.created_at ?? event.createdAt ?? event.time;
      const timestamp = toDate(tsValue);
      if (since.getTime() > 0 && timestamp <= since) {
        messageIndex++;
        continue;
      }

      const eventType = typeof event.type === "string" ? event.type : undefined;

      const chunk: CopilotCliChunk = {
        tool: "copilot-cli",
        sessionId,
        timestamp,
        role,
        content,
        metadata: {
          messageIndex,
          tokenEstimate: estimateTokens(content),
          referencedFiles: [],
          eventType,
          gitBranch,
          gitCommit,
          ...(parentToolCallId ? { subagent: true, parentToolCallId } : {}),
        },
      };
      yield chunk;
      lastEmitted = emittedPosition(chunk) ?? lastEmitted;
      messageIndex++;
    }

    // Only once the file has been read through, so an interrupted read never
    // records a position past what it delivered.
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
          // Undecided is not the same as trusted. A pass that saw no
          // `session.start` and no content never reached the fail-closed
          // guard above, so it ends with `null` — and recording that as
          // `true` told the next scan to resume here and trust everything
          // appended since. Content that nothing attributed was then indexed,
          // and the index's own `project_root` filter cannot catch it: the
          // rows carry this project's root because the scraper said so.
          //
          // `codex.ts` uses the same shape. This is the path that missed it.
          projectMatched: projectMatch ?? (this.projectRoot ? false : true),
          gitBranch,
          gitCommit,
        },
        ...(lastEmitted === undefined ? {} : { lastEmitted }),
      };
    }
  }
}

function extractRole(event: Record<string, unknown>): CopilotCliChunk["role"] | null {
  // Try event.role first.
  if (typeof event.role === "string") {
    const mapped = ROLE_MAP[event.role.toLowerCase()];
    if (mapped) return mapped;
  }

  // Try event.message.role.
  const message = event.message;
  if (isRecord(message) && typeof message.role === "string") {
    const mapped = ROLE_MAP[message.role.toLowerCase()];
    if (mapped) return mapped;
  }

  // Typed events: event.data.role, then the role implied by the event type.
  const data = event.data;
  if (isRecord(data) && typeof data.role === "string") {
    const mapped = ROLE_MAP[data.role.toLowerCase()];
    if (mapped) return mapped;
  }
  if (typeof event.type === "string") {
    const mapped = EVENT_TYPE_ROLE_MAP[event.type];
    if (mapped) return mapped;
  }

  return null;
}

/**
 * `ran <tool>: <target>` for a `tool.execution_start` event, or nothing when it
 * names no tool. The target is the first argument that says what the tool
 * acted on; arguments are never dumped whole, since an edit's would carry the
 * file's contents.
 */
function describeToolExecution(event: Record<string, unknown>): string | undefined {
  const data = event.data;
  if (!isRecord(data) || typeof data.toolName !== "string" || !data.toolName) return undefined;

  const args = isRecord(data.arguments) ? data.arguments : {};
  const target = ["path", "paths", "command", "pattern", "query", "description", "name"]
    .map((key) => args[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  const line = target
    ? `ran ${data.toolName}: ${target.replace(/\s+/g, " ").trim()}`
    : `ran ${data.toolName}`;
  return line.length > MAX_TOOL_LINE ? `${line.slice(0, MAX_TOOL_LINE - 1)}…` : line;
}

function sessionStartMatchesProject(
  event: Record<string, unknown>,
  projectRoot: string,
): boolean {
  const data = event.data;
  if (!isRecord(data)) return false;
  const context = data.context;
  if (!isRecord(context)) return false;
  const candidates = [context.cwd, context.gitRoot].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return candidates.some((candidate) => pathMatchesProject(candidate, projectRoot));
}

function extractContent(event: Record<string, unknown>): string | undefined {
  // 1. event.content as string.
  if (typeof event.content === "string") {
    const trimmed = event.content.trim();
    if (trimmed.length > 0) return trimmed;
  }

  // 2. event.text as string.
  if (typeof event.text === "string") {
    const trimmed = event.text.trim();
    if (trimmed.length > 0) return trimmed;
  }

  // 3. event.message.content as string or array of {type, text}.
  const message = event.message;
  if (isRecord(message)) {
    const inner = message.content;
    if (typeof inner === "string") {
      const trimmed = inner.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (Array.isArray(inner)) {
      const texts = inner
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item) && typeof item.text === "string") return item.text;
          return "";
        })
        .filter((t) => t.length > 0);
      const joined = texts.join("\n").trim();
      if (joined.length > 0) return joined;
    }
  }

  // 4. event.content as array of {type, text}.
  if (Array.isArray(event.content)) {
    const texts = event.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        return "";
      })
      .filter((t) => t.length > 0);
    const joined = texts.join("\n").trim();
    if (joined.length > 0) return joined;
  }

  // 5. Typed events: event.data.content / event.data.text.
  const data = event.data;
  if (isRecord(data)) {
    if (typeof data.content === "string") {
      const trimmed = data.content.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (Array.isArray(data.content)) {
      const texts = data.content
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item) && typeof item.text === "string") return item.text;
          return "";
        })
        .filter((t) => t.length > 0);
      const joined = texts.join("\n").trim();
      if (joined.length > 0) return joined;
    }
    if (typeof data.text === "string") {
      const trimmed = data.text.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return undefined;
}

/** A non-empty string, or nothing. An empty branch is no branch. */
function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
