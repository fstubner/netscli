import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { glob } from "glob";
import type { CodexChunk } from "../types/scraper.js";
import {
  AbstractScraper,
  describeType,
  driftWarner,
  emittedPosition,
  estimateTokens,
  fileSize,
  isRecord,
  toDate,
  toMessageIndex,
} from "./base.js";
import { pathMatchesProject } from "../utils/project-scope.js";
import { withDriftReport } from "./drift-log.js";
import { MAX_LINE_BYTES } from "./limits.js";
import { fileHeadHash, fileTailHash, resumeOffset } from "./base.js";
import { readJsonlLines } from "./jsonl-reader.js";
import type { EmittedPosition, FileCursor } from "../types/scraper.js";

const SCRAPER_NAME = "codex";

/**
 * Mutation shapes the codex scraper tolerates silently. Anything outside
 * this whitelist that causes records to be dropped must warn.
 */
export const ACCEPTED_DEGRADATIONS = {
  /** Sessions path missing — codex CLI simply not installed. */
  missingSessionsPath: "codex sessions directory absent",
  /** Blank / malformed JSONL line — we warn but keep reading. */
  malformedJsonlLine: "JSONL line not parseable — warned, not fatal",
  /** Event types we intentionally ignore (tool calls, meta-only events). */
  nonMessageEventType: "event is not a conversation message",
  /** response_item that carries a non-assistant role (system-injected context). */
  systemInjectedUserRole: "response_item with role != assistant",
  /** Forward-compat unknown siblings on a known event. */
  unknownFieldsAlongside: "extra keys alongside known event schema",
};

const KNOWN_EVENT_TYPES = new Set([
  "session_meta",
  "turn_context",
  "event_msg",
  "response_item",
  "compacted",
  // Environment state, not a conversation turn: it carries the AGENTS.md text
  // codex was running under. Recognised so it stops being reported as drift on
  // every scan; no branch reads it, so nothing is indexed from it.
  "world_state",
]);

const warnDrift = driftWarner(SCRAPER_NAME);

const ROLE_MAP: Record<string, CodexChunk["role"]> = {
  user: "user",
  human: "user",
  assistant: "assistant",
  system: "system",
  tool: "tool",
};

type ApprovalMode = CodexChunk["metadata"]["approvalMode"];

export class CodexCliScraper extends AbstractScraper<CodexChunk> {
  readonly tool = SCRAPER_NAME;

  constructor(
    private readonly codexSessionsPath: string,
    stateDir: string,
    private readonly projectRoot?: string,
  ) {
    super(stateDir);
  }

  async detect(): Promise<boolean> {
    try {
      const target = await stat(this.codexSessionsPath);
      return target.isDirectory() || target.isFile();
    } catch {
      return false;
    }
  }

  getStorePaths(): string[] {
    return [this.codexSessionsPath];
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
  async *scrape(since?: Date): AsyncIterable<CodexChunk> {
    const cutoff = since ?? new Date(0);
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(cutoff, true), this.stateDir);
  }

  async *fullSync(): AsyncIterable<CodexChunk> {
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(new Date(0)), this.stateDir);
  }

  parseRaw(raw: unknown): CodexChunk {
    const value = raw as Record<string, unknown>;
    const content = toStringValue(value.content) ?? "";
    const role = normalizeRole(toStringValue(value.role) ?? toStringValue(value.type));

    return {
      tool: "codex",
      sessionId: toStringValue(value.sessionId) ?? "unknown",
      timestamp: toDate(value.timestamp),
      role,
      content,
      metadata: {
        messageIndex: toMessageIndex(value.messageIndex),
        tokenEstimate: estimateTokens(content),
        referencedFiles: [],
        approvalMode: normalizeApprovalMode(toStringValue(value.approvalMode)) ?? "suggest",
        gitBranch: toStringValue(value.gitBranch),
        gitCommit: toStringValue(value.gitCommit),
        sandboxed: toBoolean(value.sandboxed),
        layer: toMessageIndex(value.layer),
      },
    };
  }

  /**
   * Processes Codex JSONL session files, which use an event-stream format.
   *
   * Each line is a JSON event with `type` ∈ {session_meta, turn_context,
   * response_item, event_msg, compacted}. Conversation messages live inside
   * `response_item` events where `payload.type === "message"`.
   *
   * Session-level state (session ID, approval mode, sandbox flag) is tracked
   * across events so that every message chunk carries accurate metadata.
   */
  /**
   * `resume` is false for `fullSync`, which exists to re-read everything.
   *
   * Both halves matter. Resuming there would defeat the purpose of the call,
   * and recording a cursor from it would leave the next incremental scrape
   * starting at end-of-file, so a rebuild would silently suppress the reads
   * that follow it.
   */
  private async *readAllSessions(since: Date, resume = false): AsyncIterable<CodexChunk> {
    const files = await this.resolveJsonlFiles();
    const fileCursors = resume ? ((await this.getLastScrapedPosition()).files ?? {}) : {};
    const updated: Record<string, FileCursor> = {};

    for (const filePath of files) {
      try {
      const sessionIdFromFile = inferSessionId(filePath);

      // Resume where the last scan stopped rather than re-reading the file.
      //
      // These are append-only logs, and re-reading them dominated every scan:
      // a real store here holds 18GB across 841 files with 94% of it in 17
      // that never change again. `resumeOffset` refuses the cursor when the
      // file has shrunk or when the carried context is missing, so a wrong
      // assumption costs a full re-read rather than skipped records.
      const size = await fileSize(filePath);
      const saved = fileCursors[filePath];
      const cursor = saved && this.cursorBackedByIndex(saved) ? saved : undefined;
      // Hashed over the window the cursor was recorded against, so an append
      // cannot change it. See `fileHeadHash`.
      const checkHash =
        resume && cursor ? await fileHeadHash(filePath, cursor.offset) : null;
      const checkTail =
        resume && cursor ? await fileTailHash(filePath, cursor.offset) : null;
      const startAt =
        size === null ? 0 : resumeOffset(cursor, size, checkHash ?? undefined, checkTail ?? undefined);
      if (size !== null && startAt > 0 && startAt >= size) {
        continue;
      }

      const resumed = startAt > 0 ? cursor?.context : undefined;

      // Session-level state, updated as we encounter meta/context events.
      // On a resume these come from the cursor: they are derived from records
      // at the head of the file that this read will never see.
      let sessionId = resumed?.sessionId ?? sessionIdFromFile;
      let approvalMode: ApprovalMode = (resumed?.approvalMode as ApprovalMode) ?? "suggest";
      let gitBranch: string | undefined = resumed?.gitBranch;
      let gitCommit: string | undefined = resumed?.gitCommit;
      let sandboxed = resumed?.sandboxed ?? false;
      let messageIndex = resumed?.messageIndex ?? 0;
      let projectMatched = resumed?.projectMatched ?? (this.projectRoot ? false : true);
      let unattributedWarned = false;
      let readTo = startAt;
      /** The last chunk handed out for this file; see `FileCursor.lastEmitted`. */
      let lastEmitted: EmittedPosition | null | undefined = resumed ? cursor?.lastEmitted : null;

      for await (const entry of readJsonlLines(filePath, { start: startAt })) {
        readTo = entry.endOffset;
        const line = entry.line;
        if (line === null) {
          // Over the cap and discarded unread. Both branches used to
          // `continue` in silence, and the classification that was meant to
          // run here sat below a length check the reader makes unreachable —
          // so an oversized record vanished permanently with nothing said,
          // measured as zero warnings for a 9MB record between two ordinary
          // ones. claude-code and copilot-cli both report this; codex was the
          // only reader that went quiet.
          //
          // Not reported unconditionally, which is the other half of why this
          // was wrong. A `compacted` record inlines the whole prior
          // conversation in `replacement_history`, so it is routinely tens of
          // megabytes and carries nothing unique — those turns are already
          // indexed from the `response_item` and `event_msg` records they were
          // copied from. A real store emits 47 of them a scan, and reporting
          // every one is the crying-wolf failure this project already made
          // once with `atis-latch`.
          //
          // The head is the whole record this reader still has, which is
          // exactly enough to read its `type`.
          if (entry.oversized && !isKnownBulkyRecord(entry.head)) {
            warnDrift(filePath, `JSONL line exceeds ${MAX_LINE_BYTES} bytes; skipped`);
          }
          continue;
        }
        if (!line.trim()) {
          continue;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch (err) {
          warnDrift(
            filePath,
            `JSONL line not parseable: ${(err as Error).message}`,
          );
          continue;
        }

        const eventType = toStringValue(parsed.type);

        // Strict-mode drift detection: an event with no readable 'type' is a
        // surprise — Codex always stamps one. A null/missing/renamed 'type'
        // means we cannot route the event and will silently lose data
        // otherwise.
        if (eventType === undefined) {
          warnDrift(
            filePath,
            `event has no readable 'type' field (got ${describeType(parsed.type)})`,
          );
          continue;
        }

        if (!KNOWN_EVENT_TYPES.has(eventType)) {
          // Unknown event type — could be a new event kind added by a newer
          // codex version. Warn so drift is observable; continue reading.
          // JSON.stringify, not raw interpolation: the value comes from a
          // transcript, and the other readers quote it the same way.
          warnDrift(filePath, `unknown event type ${JSON.stringify(eventType)}`);
          continue;
        }

        // session_meta carries the canonical session UUID.
        if (eventType === "session_meta") {
          const payload = parsed.payload;
          if (isRecord(payload)) {
            sessionId = toStringValue(payload.id) ?? sessionIdFromFile;
            // codex stamps the branch and commit at session start, which is
            // exactly the state the work happened against.
            const git = payload.git;
            if (isRecord(git)) {
              gitBranch = toStringValue(git.branch) ?? gitBranch;
              gitCommit = toStringValue(git.commit_hash) ?? gitCommit;
            }
            const match = this.matchesProject(payload.cwd);
            if (match === false) {
              // Distrust, then stop. The byte offset advanced at the top of
              // this loop, before the record was classified, and the cursor is
              // written from whatever these variables hold when the loop
              // exits — so breaking while `projectMatched` still held the
              // previous turn's `true` recorded "resume after the mismatch,
              // and trust what follows". The next scan then served the rest of
              // another project's session as this one's.
              projectMatched = false;
              break;
            }
            projectMatched = match ?? projectMatched;
          }
          continue;
        }

        // turn_context carries the approval policy and sandbox mode.
        if (eventType === "turn_context") {
          const payload = parsed.payload;
          if (isRecord(payload)) {
            const match = this.matchesProject(payload.cwd);
            if (match === false) {
              // Distrust, then stop. The byte offset advanced at the top of
              // this loop, before the record was classified, and the cursor is
              // written from whatever these variables hold when the loop
              // exits — so breaking while `projectMatched` still held the
              // previous turn's `true` recorded "resume after the mismatch,
              // and trust what follows". The next scan then served the rest of
              // another project's session as this one's.
              projectMatched = false;
              break;
            }
            projectMatched = match ?? projectMatched;
            approvalMode =
              normalizeApprovalMode(toStringValue(payload.approval_policy)) ?? approvalMode;
            const sandboxPolicy = payload.sandbox_policy;
            if (isRecord(sandboxPolicy)) {
              sandboxed = toStringValue(sandboxPolicy.type) !== "none";
            }
          }
          continue;
        }

        if (!projectMatched) {
          // Failing closed is right — an unattributable transcript must not be
          // served to this project. Failing *silently* is not: opencode warns
          // for the identical case, and a whole transcript vanishing with no
          // signal is indistinguishable from the scraper working. Warned once
          // per file, not per record.
          if (!unattributedWarned) {
            unattributedWarned = true;
            warnDrift(
              filePath,
              "no record names a project directory; transcript excluded from this project",
            );
          }
          continue;
        }

        // Actual user messages arrive as event_msg with type "user_message".
        // response_item events with role "user" are system-injected context
        // (AGENTS.md, permissions, environment) and are intentionally skipped.
        if (eventType === "event_msg") {
          const content = userMessageContent(parsed.payload, filePath);
          if (content === undefined) {
            continue;
          }
          if (!content) {
            messageIndex++;
            continue;
          }

          const timestamp = toDate(parsed.timestamp ?? parsed.created_at ?? parsed.createdAt);
          if (since.getTime() > 0 && timestamp <= since) {
            messageIndex++;
            continue;
          }

          const chunk = this.parseRaw({
            sessionId,
            messageIndex,
            timestamp,
            role: "user",
            content,
            approvalMode,
            sandboxed,
            gitBranch,
            gitCommit,
          });
          yield chunk;
          lastEmitted = emittedPosition(chunk) ?? lastEmitted;
          messageIndex++;
          continue;
        }

        // compacted events hold AI-generated summaries of prior turns that were
        // removed from the active context window to save space. They represent
        // a higher-abstraction view of the conversation (layer 1).
        if (eventType === "compacted") {
          const content = compactedSummary(parsed.payload);
          if (!content) {
            continue;
          }

          const timestamp = toDate(parsed.timestamp ?? parsed.created_at ?? parsed.createdAt);
          if (since.getTime() === 0 || timestamp > since) {
            const chunk = this.parseRaw({
              sessionId,
              messageIndex,
              timestamp,
              role: "assistant",
              content,
              approvalMode,
              sandboxed,
              gitBranch,
              gitCommit,
              layer: 1,
            });
            yield chunk;
            lastEmitted = emittedPosition(chunk) ?? lastEmitted;
          }
          // Consume the index below the cutoff too, so chunk identity is
          // stable between full and incremental scrapes.
          messageIndex++;
          continue;
        }

        // Only assistant messages from response_item events are conversation turns.
        if (eventType !== "response_item") continue;

        const payload = parsed.payload;
        if (!isRecord(payload)) {
          warnDrift(
            filePath,
            `response_item payload is not an object (got ${describeType(payload)})`,
          );
          continue;
        }
        if (payload.type !== "message") {
          if (!("type" in payload)) {
            warnDrift(
              filePath,
              "response_item payload missing 'type' key — likely renamed",
            );
          }
          continue;
        }

        // Skip system-injected context which Codex sends as "user" role items.
        const role = toStringValue(payload.role);
        if (role !== "assistant") {
          if (!("role" in payload)) {
            warnDrift(
              filePath,
              "response_item message payload missing 'role' key",
            );
          }
          messageIndex++;
          continue;
        }

        // Extract text from the content-part array (or plain string fallback).
        const content = extractContent(payload.content);
        if (!content) {
          messageIndex++;
          continue;
        }

        const timestamp = toDate(parsed.timestamp ?? parsed.created_at ?? parsed.createdAt);
        if (since.getTime() > 0 && timestamp <= since) {
          messageIndex++;
          continue;
        }

        const chunk = this.parseRaw({
          sessionId,
          messageIndex,
          timestamp,
          role,
          content,
          approvalMode,
          sandboxed,
          gitBranch,
          gitCommit,
        });
        yield chunk;
        lastEmitted = emittedPosition(chunk) ?? lastEmitted;
        messageIndex++;
      }

      // Only after the file has been read through without throwing. Recording
      // a position mid-read would skip whatever the failure interrupted.
      if (resume && size !== null) {
        const recordHash = await fileHeadHash(filePath, readTo);
        const recordTail = await fileTailHash(filePath, readTo);
        updated[filePath] = {
          offset: readTo,
          size,
          ...(recordHash ? { headHash: recordHash } : {}),
          ...(recordTail ? { tailHash: recordTail } : {}),
          context: {
            sessionId,
            messageIndex,
            projectMatched,
            approvalMode,
            gitBranch,
            gitCommit,
            sandboxed,
          },
          ...(lastEmitted === undefined ? {} : { lastEmitted }),
        };
      }
      } catch (err) {
        // One unreadable file must not abort the remaining session files, and
        // no cursor is recorded for it — the next scan reads it again from
        // wherever it last succeeded.
        warnDrift(filePath, `unreadable transcript file: ${(err as Error).message}`);
      }
    }

    if (Object.keys(updated).length > 0) {
      // Merged by `saveScrapedPosition`, so this does not disturb the
      // `lastTimestamp` the index writes when the whole scrape completes.
      await this.saveScrapedPosition({ files: updated });
    }
  }

  private matchesProject(value: unknown): boolean | undefined {
    if (!this.projectRoot) {
      return true;
    }
    const cwd = toStringValue(value);
    return cwd ? pathMatchesProject(cwd, this.projectRoot) : undefined;
  }

  /**
   * Recursively resolves JSONL files under the sessions directory.
   * Codex stores sessions in year/month/day subdirectories.
   */
  private async resolveJsonlFiles(): Promise<string[]> {
    try {
      const target = await stat(this.codexSessionsPath);
      if (target.isFile()) {
        return this.codexSessionsPath.endsWith(".jsonl") ? [this.codexSessionsPath] : [];
      }

      if (!target.isDirectory()) {
        return [];
      }

      return await glob("**/*.jsonl", {
        cwd: this.codexSessionsPath,
        absolute: true,
        nodir: true,
      });
    } catch {
      return [];
    }
  }
}

/**
 * Extracts text from a Codex content-part value.
 * Content is an array of {type, text} objects or a plain string.
 */
function extractContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const texts = value
      .map((item) => (isRecord(item) ? toStringValue(item.text) : undefined))
      .filter((t): t is string => t !== undefined);
    const joined = texts.join("\n").trim();
    return joined.length > 0 ? joined : undefined;
  }

  return undefined;
}

function normalizeRole(value?: string): CodexChunk["role"] {
  if (!value) {
    return "system";
  }

  return ROLE_MAP[value.toLowerCase()] ?? "system";
}

function normalizeApprovalMode(value?: string): ApprovalMode | null {
  switch (value) {
    case "suggest":
      return "suggest";
    case "auto-edit":
      return "auto-edit";
    case "full-auto":
      return "full-auto";
    default:
      // Unknown/future policy values keep the previously observed mode
      // rather than silently downgrading the record to "suggest".
      return null;
  }
}

function inferSessionId(filePath: string): string {
  return basename(filePath).replace(".jsonl", "") || "unknown";
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

/**
 * Record types expected to exceed the line cap while carrying nothing the
 * conversation does not already hold elsewhere in the file.
 *
 * Measured on a real 865MB transcript: 47 of 21,109 lines exceeded 8MB, the
 * largest 22.4MB, and every one was `compacted`.
 */
const BULKY_RESTATEMENT_TYPES = new Set(["compacted"]);

/** How much of an oversized line to inspect for its `type`. */
const TYPE_PEEK_CHARS = 200;

/** @internal Exported for tests only. */
export function isKnownBulkyRecord(line: string): boolean {
  const type = /"type"\s*:\s*"([^"]+)"/.exec(line.slice(0, TYPE_PEEK_CHARS))?.[1];
  return type !== undefined && BULKY_RESTATEMENT_TYPES.has(type);
}

/**
 * The text of a `user_message` event, or nothing when this record is not one.
 *
 * Three outcomes, and the caller needs to tell them apart: `undefined` means
 * the record is not a user message at all and should be skipped without
 * consuming a message index; `""` means it is one but carries no text, which
 * still consumes an index so chunk identity stays stable between a full and
 * an incremental scrape; anything else is the message.
 *
 * Two shapes, because Codex changed one and kept writing the other for a
 * while. The original is `payload.type === "user_message"` with the text on
 * `payload.message`. The current one wraps it: `payload.type ===
 * "item_completed"` with `payload.item.type === "UserMessage"`.
 *
 * Reading only the original meant every human turn in a current transcript
 * was dropped, silently — `event_msg` is a known type and `payload.type` was
 * present, so the drift guard below had nothing to complain about. Measured
 * across a real store of 825 session files: 41 turns in the old shape, 15,169
 * in the new one. A scrape of that history returned the assistant side of
 * every Codex conversation and almost none of what the person asked for.
 *
 * `response_item` events with role "user" are still deliberately not handled
 * here: they are system-injected context (AGENTS.md, permissions,
 * environment), not something the person typed, and they outnumber the real
 * turns in a file that carries both.
 */
function userMessageContent(payload: unknown, filePath: string): string | undefined {
  if (!isRecord(payload)) {
    warnDrift(filePath, `event_msg payload is not an object (got ${describeType(payload)})`);
    return undefined;
  }

  if (payload.type === "user_message") {
    return toStringValue(payload.message) ?? "";
  }

  if (payload.type === "item_completed") {
    const item = payload.item;
    if (!isRecord(item) || item.type !== "UserMessage") {
      // Every other item type is an event this scraper reads elsewhere or
      // does not read at all; neither is drift.
      return undefined;
    }
    // The text sits in a parts array, the way the assistant side does:
    // `content: [{ type: "text", text: "..." }]`. A flat `text` is accepted
    // too, so an older or simpler record still reads.
    if (Array.isArray(item.content)) {
      const text = item.content
        .filter((part): part is Record<string, unknown> => isRecord(part))
        .map((part) => toStringValue(part.text) ?? "")
        .filter((part) => part.length > 0)
        .join("\n");
      return text;
    }
    return toStringValue(item.text) ?? "";
  }

  // A payload with no `type` at all is drift worth seeing; a payload with a
  // different one is just an event this scraper does not read.
  if (!("type" in payload)) {
    warnDrift(filePath, "event_msg payload missing 'type' key — likely renamed");
  }
  return undefined;
}

/**
 * The summary text of a `compacted` event, under whichever key it arrives.
 *
 * Compacted events hold AI-generated summaries of turns dropped from the
 * active context window, so they are a higher-abstraction view of the same
 * conversation (layer 1 at the call site).
 */
function compactedSummary(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  return (
    toStringValue(payload.summary) ?? toStringValue(payload.content) ?? toStringValue(payload.text)
  );
}
