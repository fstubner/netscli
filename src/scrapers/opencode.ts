import { stat } from "node:fs/promises";
import type { OpenCodeChunk } from "../types/scraper.js";
import { pathMatchesProject } from "../utils/project-scope.js";
import { AbstractScraper, describeType, driftWarner, estimateTokens, isRecord, toDate } from "./base.js";
import { withDriftReport } from "./drift-log.js";

const SCRAPER_NAME = "opencode";

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
}

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
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
    const cutoff = since ?? state.lastTimestamp;
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(cutoff), this.stateDir);
  }

  async *fullSync(): AsyncIterable<OpenCodeChunk> {
    yield* withDriftReport(SCRAPER_NAME, this.readAllSessions(new Date(0)), this.stateDir);
  }

  private async *readAllSessions(since: Date): AsyncIterable<OpenCodeChunk> {
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

    try {
      yield* this.readFromDb(db, since);
    } finally {
      db.close();
    }
  }

  private *readFromDb(
    db: import("better-sqlite3").Database,
    since: Date,
  ): Iterable<OpenCodeChunk> {
    let sessions: SessionRow[];
    try {
      sessions = db
        .prepare(
          "SELECT id, time_created, title, directory FROM session ORDER BY time_created ASC",
        )
        .all() as SessionRow[];
    } catch {
      // Older opencode schemas may lack the directory column; retry without it.
      try {
        sessions = (
          db
            .prepare("SELECT id, time_created, title FROM session ORDER BY time_created ASC")
            .all() as Omit<SessionRow, "directory">[]
        ).map((row) => ({ ...row, directory: null }));
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
        return;
      }
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
      return;
    }

    let getMessages: import("better-sqlite3").Statement;
    let getParts: import("better-sqlite3").Statement;
    try {
      getMessages = db.prepare(
        "SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC",
      );
      getParts = db.prepare(
        "SELECT id, message_id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created ASC, id ASC",
      );
    } catch (err) {
      warnDrift(
        this.opencodeDbPath,
        `message/part table prepare failed: ${(err as Error).message}`,
      );
      return;
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
        if (since.getTime() > 0 && timestamp <= since) {
          messageIndex++;
          continue;
        }

        let parts: PartRow[];
        try {
          parts = getParts.all(msg.id) as PartRow[];
        } catch (err) {
          warnDrift(
            `${this.opencodeDbPath}#message:${msg.id}`,
            `part query failed: ${(err as Error).message}`,
          );
          messageIndex++;
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
              messageIndex,
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
              messageIndex,
              tokenEstimate: estimateTokens(toolContent),
              referencedFiles: [],
              ...metadata,
            },
          };
        }
        messageIndex++;
      }
    }
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
