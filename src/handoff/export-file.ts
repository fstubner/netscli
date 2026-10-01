/**
 * The `xtctx export` file format, version 1.
 *
 * JSON Lines, UTF-8, one JSON object per line, three kinds of line:
 *
 *   {"type":"xtctx-export","format_version":1,"exported_at":"…","project_root":"…","xtctx_version":"…"}
 *   {"type":"session","session_ref":"claude-code:…","tool":"claude-code", … ,"messages":[{…}, …]}
 *   {"type":"end","sessions":56,"messages":17176}
 *
 * The header comes first, then one line per session carrying all of its
 * messages, then the end line. Session and message fields are the index's
 * own column names (see `ArchivedSession`), so a line is the stored rows and
 * nothing is translated on the way out or in.
 *
 * One session per line so an import commits a session at a time, and a file
 * cut short loses whole sessions rather than leaving one half-imported. The
 * end line is how a file cut short is recognised at all: it is written last,
 * and it counts what came before it.
 *
 * Only `sessions` and `messages` are written. Retrieval windows, their keyword
 * index and vectors are derived from messages and rebuilt on import; vectors
 * also belong to one embedding model and device, so they would be wrong on a
 * machine configured differently.
 */
import type { ArchivedMessage, ArchivedSession } from "./archive.js";

export const EXPORT_FORMAT = "xtctx-export";
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportHeader {
  type: typeof EXPORT_FORMAT;
  format_version: number;
  exported_at: string;
  project_root: string;
  xtctx_version?: string;
}

export interface ExportEnd {
  type: "end";
  sessions: number;
  messages: number;
}

export function headerLine(projectRoot: string, xtctxVersion?: string): string {
  const header: ExportHeader = {
    type: EXPORT_FORMAT,
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    project_root: projectRoot,
    ...(xtctxVersion ? { xtctx_version: xtctxVersion } : {}),
  };
  return JSON.stringify(header);
}

export function sessionLine(session: ArchivedSession): string {
  return JSON.stringify({ type: "session", ...session });
}

export function endLine(sessions: number, messages: number): string {
  const end: ExportEnd = { type: "end", sessions, messages };
  return JSON.stringify(end);
}

/** The file is not an export this build can read; nothing was imported. */
export class ExportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFormatError";
  }
}

/** Throws ExportFormatError unless `value` is a header this build reads. */
export function checkHeader(value: unknown): ExportHeader {
  const header = value as Partial<ExportHeader> | null;
  if (!header || typeof header !== "object" || header.type !== EXPORT_FORMAT) {
    throw new ExportFormatError("not an xtctx export: the first line is not an xtctx-export header");
  }
  if (typeof header.format_version !== "number") {
    throw new ExportFormatError("not an xtctx export: the header has no format_version");
  }
  if (header.format_version > EXPORT_FORMAT_VERSION) {
    throw new ExportFormatError(
      `this export is format version ${header.format_version}, written by a newer xtctx; ` +
        `this one reads version ${EXPORT_FORMAT_VERSION}. Upgrade xtctx to import it.`,
    );
  }
  return header as ExportHeader;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function optionalString(value: unknown): string | null {
  return isString(value) ? value : null;
}

/**
 * A session line as an `ArchivedSession`, or why it is not one.
 *
 * Checked field by field because the file may have been edited, truncated
 * mid-line, or written by something else: a line that is not a whole session
 * is reported and skipped, never written half-formed into the index.
 */
export function parseSessionLine(value: Record<string, unknown>): ArchivedSession | string {
  for (const field of ["session_ref", "tool", "source_session_id", "started_at", "last_activity_at"]) {
    if (!isString(value[field]) || (value[field] as string).length === 0) {
      return `session has no ${field}`;
    }
  }
  if (!Array.isArray(value.messages)) {
    return "session has no messages array";
  }

  const messages: ArchivedMessage[] = [];
  for (const [position, raw] of (value.messages as unknown[]).entries()) {
    const message = raw as Record<string, unknown> | null;
    if (!message || typeof message !== "object") {
      return `message ${position} is not an object`;
    }
    for (const field of ["id", "timestamp", "role", "content", "content_hash"]) {
      if (!isString(message[field])) {
        return `message ${position} has no ${field}`;
      }
    }
    if (typeof message.message_index !== "number" || !Number.isInteger(message.message_index)) {
      return `message ${position} has no message_index`;
    }
    messages.push({
      id: message.id as string,
      timestamp: message.timestamp as string,
      role: message.role as string,
      content: message.content as string,
      message_index: message.message_index,
      content_hash: message.content_hash as string,
      metadata_json: isString(message.metadata_json) ? message.metadata_json : "{}",
      source_pointer: optionalString(message.source_pointer),
    });
  }

  return {
    session_ref: value.session_ref as string,
    tool: value.tool as string,
    source_session_id: value.source_session_id as string,
    project_root: optionalString(value.project_root) ?? "",
    git_branch: optionalString(value.git_branch),
    git_commit: optionalString(value.git_commit),
    started_at: value.started_at as string,
    last_activity_at: value.last_activity_at as string,
    preview: optionalString(value.preview),
    source_path: optionalString(value.source_path),
    messages,
  };
}
