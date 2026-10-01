import { stat } from "node:fs/promises";
import type { OpenCodeChunk } from "../types/scraper.js";
import { pathMatchesProject } from "../utils/project-scope.js";
import { AbstractScraper, describeType, driftWarner, estimateTokens, isRecord, toDate } from "./base.js";
import { withDriftReport } from "./drift-log.js";

const SCRAPER_NAME = "opencode";

/**
 * Bumped when the scraper's output for a session it has already read changes,
 * so that already-indexed rows are corrected rather than kept.
 *
 * 1 (absent from state): text parts only, so an assistant turn made of tool
 *    calls left nothing.
 * 2: tool parts leave a 'tool' line.
 *
 * The cursor sits past every session already read, so without this the old
 * rows stay as they were until a session is next touched. A stored version
 * below this resets the cutoff for one scan, which re-reads every session
 * still in the database through the normal path; the index's re-read prune
 * then replaces the old rows of each. Sessions that have left the database
 * are not re-read, so their rows keep the old shape: they are the only copy,
 * which is why this corrects in place instead of rebuilding.
 */
export const OPENCODE_SCRAPER_VERSION = 2;

/**
 * Mutation shapes the opencode scraper tolerates silently. Anything outside
 * this whitelist that drops records must warn (or throw for required tables).
 */
export const ACCEPTED_DEGRADATIONS = {
  /** opencode.db missing — opencode CLI not installed on this machine. */
  missingDatabase: "opencode database absent",
  /** better-sqlite3 native module unavailable — opt-in peer dep. */
  missingSqliteBinding: "better-sqlite3 native module unavailable",
  /** Sessions table empty — pristine opencode install. */
  emptySessions: "no sessions in opencode database",
  /** A part with no extractable text (file, snapshot, step events). */
  nonTextPart: "part is not a text/reasoning part",
  /** Reasoning parts on assistant messages — internal model thoughts; skipped by default. */
  reasoningPart: "reasoning part skipped (internal thought)",
  /** Forward-compat unknown keys alongside known fields. */
  unknownFieldsAlongside: "extra keys alongside known opencode schema",
  /** A message data row that fails to parse as JSON — skip with warn. */
  malformedMessageData: "Message.data not parseable JSON",
  /** A part data row that fails to parse as JSON — skip with warn. */
  malformedPartData: "Part.data not parseable JSON",
};

const warnDrift = driftWarner(SCRAPER_NAME);

interface SessionRow {
  id: string;
  time_created: number;
  title: string | null;
  directory: string | null;
  time_updated: number | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number | null;
  data: string;
}

interface PartRow {
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

interface MessageData {
  role?: string;
  agent?: string;
  modelID?: string;
  providerID?: string;
  model?: { providerID?: string; modelID?: string };
  time?: { created?: number };
}

interface PartData {
  type?: string;
  text?: string;
  /** On a `tool` part: the tool's name, and the state its call reached. */
  tool?: string;
  state?: { title?: unknown; input?: unknown };
}

export class OpenCodeScraper extends AbstractScraper<OpenCodeChunk> {
  readonly tool = SCRAPER_NAME;

  constructor(
    private readonly opencodeDbPath: string,
    stateDir: string,
    private readonly projectRoot?: string,
  ) {
    super(stateDir);
  }

  async detect(): Promise<boolean> {
    try {
      const target = await stat(this.opencodeDbPath);
      return target.isFile();
    } catch {
      return false;
    }
  }

  getStorePaths(): string[] {
    return [this.opencodeDbPath];
  }

  async *scrape(since?: Date): AsyncIterable<OpenCodeChunk> {
    const state = await this.getLastScrapedPosition();
    const outdated = since === undefined && (state.scraperVersion ?? 1) < OPENCODE_SCRAPER_VERSION;
    const cutoff = since ?? (outdated ? new Date(0) : state.lastTimestamp);
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(cutoff, outdated), this.stateDir);
  }

  async *fullSync(): AsyncIterable<OpenCodeChunk> {
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(new Date(0)), this.stateDir);
  }

  private async *readAllSessions(since: Date, recordVersion = false): AsyncIterable<OpenCodeChunk> {
    try {
      const target = await stat(this.opencodeDbPath);
      if (!target.isFile()) {
        return;
      }
    } catch {
      // ACCEPTED_DEGRADATIONS.missingDatabase
      return;
    }

    type DatabaseConstructor = new (
      path: string,
      options?: import("better-sqlite3").Options,
    ) => import("better-sqlite3").Database;
    let Database: DatabaseConstructor | undefined;
    try {
      // Dynamic import so the module remains optional at startup.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Database = ((await import("better-sqlite3")) as any).default as DatabaseConstructor;
    } catch {
      // ACCEPTED_DEGRADATIONS.missingSqliteBinding
      return;
    }
    if (!Database) return;

    let db: import("better-sqlite3").Database;
    try {
      db = new Database(this.opencodeDbPath, { readonly: true, fileMustExist: true });
    } catch (err) {
      // The file exists (checked above), so failing to open it is a broken
      // store, not an absent one. Reporting it as absent made a corrupt
      // database read as a pristine install in status.
      throw new Error(
        `[${SCRAPER_NAME}] opencode database at ${this.opencodeDbPath} could not be opened: ${(err as Error).message}`,
      );
    }

    let complete: boolean;
    try {
      complete = yield* this.readFromDb(db, since);
    } finally {
      db.close();
    }

    // Reached only when the read ran to the end: a scan that throws abandons
    // the generator before this line, and a database whose tables could not be
    // queried reports drift and carries on, having re-read nothing.
    if (recordVersion && complete) {
      await this.saveScrapedPosition({ scraperVersion: OPENCODE_SCRAPER_VERSION });
    }
  }

  /** Returns whether the sessions could actually be read. */
  private *readFromDb(
    db: import("better-sqlite3").Database,
    since: Date,
  ): Generator<OpenCodeChunk, boolean, void> {
    let sessions: SessionRow[];
    try {
      // Columns are looked up rather than assumed: older schemas lack
      // `directory`, and `time_updated` is what says a session changed.
      const columns = tableColumns(db, "session");
      const selected = ["id", "time_created", "title"];
      for (const optional of ["directory", "time_updated"]) {
        if (columns.has(optional)) selected.push(optional);
      }
      sessions = (
        db
          .prepare(`SELECT ${selected.join(", ")} FROM session ORDER BY time_created ASC`)
          .all() as Array<Partial<SessionRow> & Pick<SessionRow, "id" | "time_created" | "title">>
      ).map((row) => ({ directory: null, time_updated: null, ...row }));
    } catch (err) {
      const message = (err as Error).message;
      if (/not a database|file is encrypted|malformed|corrupt/i.test(message)) {
        // Corruption, not schema drift — surface it rather than reporting
        // an empty store.
        throw new Error(
          `[${SCRAPER_NAME}] opencode database at ${this.opencodeDbPath} is unreadable: ${message}`,
        );
      }
      warnDrift(this.opencodeDbPath, `session table query failed: ${message}`);
      return false;
    }

    if (this.projectRoot) {
      const root = this.projectRoot;
      // Fail closed: a session with no directory cannot be attributed to a
      // project, so scoped indexing must never include it.
      const unattributable = sessions.filter((session) => session.directory === null).length;
      if (unattributable > 0) {
        warnDrift(
          this.opencodeDbPath,
          "sessions without a 'directory' value cannot be attributed to a project; skipped under project scoping",
        );
      }
      sessions = sessions.filter(
        (session) => session.directory !== null && pathMatchesProject(session.directory, root),
      );
    }

    if (sessions.length === 0) {
      // ACCEPTED_DEGRADATIONS.emptySessions
      return true;
    }

    let getMessages: import("better-sqlite3").Statement;
    let getParts: import("better-sqlite3").Statement;
    try {
      const messageColumns = tableColumns(db, "message");
      getMessages = db.prepare(
        `SELECT id, session_id, time_created, ${
          messageColumns.has("time_updated") ? "time_updated" : "NULL AS time_updated"
        }, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC`,
      );
      getParts = db.prepare(
        "SELECT id, message_id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created ASC, id ASC",
      );
    } catch (err) {
      warnDrift(
        this.opencodeDbPath,
        `message/part table prepare failed: ${(err as Error).message}`,
      );
      return false;
    }

    for (const session of sessions) {
      let messages: MessageRow[];
      try {
        messages = getMessages.all(session.id) as MessageRow[];
      } catch (err) {
        warnDrift(
          `${this.opencodeDbPath}#session:${session.id}`,
          `message query failed: ${(err as Error).message}`,
        );
        continue;
      }

      interface ParsedMessage {
        row: MessageRow;
        data: MessageData;
        role: OpenCodeChunk["role"];
        timestamp: Date;
        messageIndex: number;
      }
      const parsed: ParsedMessage[] = [];

      // Whether anything in the session has changed since the cursor. A full
      // read always has, and the session row's own `time_updated` counts: a
      // message still streaming when it was last read is edited in place, so
      // it is older than the cursor yet different from what was stored.
      let changed = since.getTime() <= 0 || timeAfter(session.time_updated, since);

      let messageIndex = 0;
      for (const msg of messages) {
        let msgData: MessageData;
        try {
          msgData = JSON.parse(msg.data) as MessageData;
        } catch (err) {
          warnDrift(
            `${this.opencodeDbPath}#message:${msg.id}`,
            `message.data not parseable JSON: ${(err as Error).message}`,
          );
          continue;
        }

        if (!isRecord(msgData as unknown)) {
          warnDrift(
            `${this.opencodeDbPath}#message:${msg.id}`,
            `message.data is not an object (got ${describeType(msgData)})`,
          );
          continue;
        }

        if (!("role" in (msgData as Record<string, unknown>))) {
          warnDrift(
            `${this.opencodeDbPath}#message:${msg.id}`,
            "message.data missing 'role' field — likely renamed",
          );
          continue;
        }
        if (typeof msgData.role !== "string") {
          warnDrift(
            `${this.opencodeDbPath}#message:${msg.id}`,
            `expected 'role' to be a string, got ${describeType(msgData.role)}`,
          );
          continue;
        }
        const role = normalizeRole(msgData.role);

        // Timestamp: prefer msgData.time.created, fall back to msg.time_created.
        const tsValue = msgData.time?.created ?? msg.time_created;
        const timestamp = toDate(tsValue);
        if (timestamp > since || timeAfter(msg.time_updated, since)) {
          changed = true;
        }

        parsed.push({ row: msg, data: msgData, role, timestamp, messageIndex });
        messageIndex++;
      }

      // A session is read whole or not at all. Reading only the messages past
      // the cursor missed one that was still streaming at the last scan, and
      // when a later read did pick it up its final text arrived under a new id
      // beside the partial row already stored. A read from the first message
      // lets the index replace what it holds for the session instead, and
      // costs one session's rows rather than a gap.
      if (!changed) {
        continue;
      }

      for (const { row: msg, data: msgData, role, timestamp, messageIndex: index } of parsed) {
        let parts: PartRow[];
        try {
          parts = getParts.all(msg.id) as PartRow[];
        } catch (err) {
          warnDrift(
            `${this.opencodeDbPath}#message:${msg.id}`,
            `part query failed: ${(err as Error).message}`,
          );
          continue;
        }

        const textSegments: string[] = [];
        const toolLines: string[] = [];
        for (const part of parts) {
          let partData: PartData;
          try {
            partData = JSON.parse(part.data) as PartData;
          } catch (err) {
            warnDrift(
              `${this.opencodeDbPath}#part:${part.id}`,
              `part.data not parseable JSON: ${(err as Error).message}`,
            );
            continue;
          }

          if (!isRecord(partData as unknown)) {
            warnDrift(
              `${this.opencodeDbPath}#part:${part.id}`,
              `part.data is not an object (got ${describeType(partData)})`,
            );
            continue;
          }

          // Text parts are the conversation, and a tool part leaves one line
          // of what was run. Reasoning, file, snapshot, step etc. are skipped
          // silently.
          if (partData.type === "text") {
            const text = typeof partData.text === "string" ? partData.text : "";
            if (text.length > 0) {
              textSegments.push(text);
            }
            continue;
          }
          if (partData.type === "tool") {
            toolLines.push(describeToolPart(partData));
            continue;
          }

          // ACCEPTED_DEGRADATIONS.nonTextPart / reasoningPart — silent skip.
        }

        const model = msgData.modelID ?? msgData.model?.modelID;
        const providerID = msgData.providerID ?? msgData.model?.providerID;
        const metadata = {
          agent: typeof msgData.agent === "string" ? msgData.agent : undefined,
          model,
          providerID,
        };

        const content = textSegments.join("\n").trim();
        if (content) {
          yield {
            tool: "opencode",
            sessionId: session.id,
            timestamp,
            role,
            content,
            metadata: {
              messageIndex: index,
              tokenEstimate: estimateTokens(content),
              referencedFiles: [],
              ...metadata,
            },
          };
        }

        if (toolLines.length > 0) {
          // A turn that only ran tools left no trace at all. One chunk per
          // message, a line per call: rows are ordered by time, then index,
          // then id, so separate chunks sharing a timestamp would come back in
          // hash order. The millisecond puts the calls after the message's
          // own text, which is where they happened.
          const toolContent = toolLines.join("\n");
          yield {
            tool: "opencode",
            sessionId: session.id,
            timestamp: new Date(timestamp.getTime() + 1),
            role: "tool",
            content: toolContent,
            metadata: {
              messageIndex: index,
              tokenEstimate: estimateTokens(toolContent),
              referencedFiles: [],
              ...metadata,
            },
          };
        }
      }
    }
    return true;
  }
}

const TOOL_LINE_MAX = 200;

/** Names a tool call's input records its target under, most specific first. */
const TOOL_TARGET_KEYS = ["filePath", "path", "pattern", "command", "url", "query", "description"];

/**
 * One short line for a tool part: `used read: src/a.ts`.
 *
 * The state's `title` is opencode's own one-line summary of the call, so it is
 * preferred; the input is the fallback. Neither the input as a whole nor the
 * output is indexed — a write's input is the file and a read's output is the
 * file's contents.
 */
function describeToolPart(part: PartData): string {
  const name = typeof part.tool === "string" && part.tool.trim() ? part.tool.trim() : "tool";
  const state = isRecord(part.state as unknown) ? (part.state as Record<string, unknown>) : {};
  const input = isRecord(state.input) ? state.input : {};

  const firstLine = (value: unknown): string =>
    typeof value === "string" && value.trim() ? (value.trim().split(/\r?\n/, 1)[0] ?? "") : "";

  let target = firstLine(state.title);
  for (const key of TOOL_TARGET_KEYS) {
    if (target) break;
    target = firstLine(input[key]);
  }

  const line = target ? `used ${name}: ${target}` : `used ${name}`;
  return line.length > TOOL_LINE_MAX ? `${line.slice(0, TOOL_LINE_MAX)}…` : line;
}

/** The column names of a table; empty when there is no such table. */
function tableColumns(db: import("better-sqlite3").Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

/** Whether a row's time column is later than the cursor; absent counts as not. */
function timeAfter(value: unknown, since: Date): boolean {
  return value !== null && value !== undefined && toDate(value) > since;
}

function normalizeRole(value: unknown): OpenCodeChunk["role"] {
  if (typeof value !== "string") return "system";
  switch (value.toLowerCase()) {
    case "user":
    case "human":
      return "user";
    case "assistant":
    case "ai":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
      return "system";
    default:
      return "system";
  }
}
