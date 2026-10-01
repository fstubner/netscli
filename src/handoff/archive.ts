import { existsSync, rmSync, statSync } from "node:fs";
import Database from "better-sqlite3";
import type { Database as DatabaseHandle } from "better-sqlite3";
import { hashParts } from "./hash.js";
import { isCorruptDatabaseError } from "./schema.js";

/**
 * A session and its messages as stored, outside any one index.
 *
 * The two tables nothing else can rebuild. Windows, their FTS rows and
 * vectors are all derived from `messages`, so moving a session between
 * indexes -- carrying it forward from a set-aside file, or importing an
 * export -- moves these and lets the receiving index derive the rest.
 *
 * Field names are the column names, so an export is the stored rows and
 * nothing has to be translated or can be lost on the way.
 */
export interface ArchivedSession {
  session_ref: string;
  tool: string;
  source_session_id: string;
  project_root: string;
  git_branch: string | null;
  git_commit: string | null;
  started_at: string;
  last_activity_at: string;
  preview: string | null;
  source_path: string | null;
  messages: ArchivedMessage[];
}

export interface ArchivedMessage {
  id: string;
  timestamp: string;
  role: string;
  content: string;
  message_index: number;
  content_hash: string;
  metadata_json: string;
  source_pointer: string | null;
}

type Row = Record<string, unknown>;

function text(row: Row, column: string): string | null {
  const value = row[column];
  return typeof value === "string" ? value : null;
}

/**
 * Read one session, tolerating columns an older schema did not have.
 *
 * `SELECT *` rather than a column list because the source may be a set-aside
 * file from any version, including one set aside precisely because its shape
 * was not recognised. A column it lacks reads as null; a session lacking what
 * the index cannot do without returns null.
 */
export function readArchivedSession(db: DatabaseHandle, sessionRef: string): ArchivedSession | null {
  const row = db.prepare("SELECT * FROM sessions WHERE session_ref = ?").get(sessionRef) as Row | undefined;
  if (!row) {
    return null;
  }
  const tool = text(row, "tool");
  const startedAt = text(row, "started_at");
  if (tool === null || startedAt === null) {
    return null;
  }
  const messages = (
    db
      .prepare(
        `SELECT * FROM messages WHERE session_ref = ?
         ORDER BY timestamp ASC, message_index ASC, id ASC`,
      )
      .all(sessionRef) as Row[]
  ).flatMap((message): ArchivedMessage[] => {
    const id = text(message, "id");
    const timestamp = text(message, "timestamp");
    const role = text(message, "role");
    const content = text(message, "content");
    if (id === null || timestamp === null || role === null || content === null) {
      return [];
    }
    return [
      {
        id,
        timestamp,
        role,
        content,
        message_index: typeof message.message_index === "number" ? message.message_index : 0,
        content_hash: text(message, "content_hash") ?? hashParts([content]),
        metadata_json: text(message, "metadata_json") ?? "{}",
        source_pointer: text(message, "source_pointer"),
      },
    ];
  });

  return {
    session_ref: sessionRef,
    tool,
    source_session_id: text(row, "source_session_id") ?? sessionRef.slice(tool.length + 1),
    project_root: text(row, "project_root") ?? "",
    git_branch: text(row, "git_branch"),
    git_commit: text(row, "git_commit"),
    started_at: startedAt,
    last_activity_at: text(row, "last_activity_at") ?? startedAt,
    preview: text(row, "preview"),
    source_path: text(row, "source_path"),
    messages,
  };
}

export interface MergeResult {
  /** The index had no session under this ref before. */
  created: boolean;
  /** Messages the index did not already hold, by id. */
  messagesAdded: number;
}

/**
 * Prepare a merge of whole sessions into `db`; each call is one transaction.
 *
 * Message ids are deterministic hashes of the message itself, so merging the
 * same session twice adds nothing the second time, and merging one the index
 * already holds adds only the messages it lacks. A session already present
 * has its time span widened and the fields it never had filled; what it does
 * have is kept, except `project_root`, which is taken from the caller for the
 * same reason the scan's upsert takes it: merging a session into a project is
 * the statement that it belongs to that project.
 *
 * Roll-ups and retrieval windows are left to the caller, which already has
 * the code that derives them from messages.
 */
export function createSessionMerger(
  db: DatabaseHandle,
): (session: ArchivedSession, projectRoot: string) => MergeResult {
  const exists = db.prepare("SELECT 1 FROM sessions WHERE session_ref = ?");
  const upsertSession = db.prepare(
    `INSERT INTO sessions
     (session_ref, tool, source_session_id, project_root, git_branch, git_commit,
      started_at, last_activity_at, message_count, preview, source_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(session_ref) DO UPDATE SET
       started_at = MIN(started_at, excluded.started_at),
       last_activity_at = MAX(last_activity_at, excluded.last_activity_at),
       git_branch = COALESCE(git_branch, excluded.git_branch),
       git_commit = COALESCE(git_commit, excluded.git_commit),
       preview = COALESCE(preview, excluded.preview),
       source_path = COALESCE(source_path, excluded.source_path),
       project_root = excluded.project_root`,
  );
  const insertMessage = db.prepare(
    `INSERT OR IGNORE INTO messages
     (id, session_ref, tool, source_session_id, timestamp, role, content,
      message_index, content_hash, metadata_json, source_pointer, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return db.transaction((session: ArchivedSession, projectRoot: string): MergeResult => {
    const created = exists.get(session.session_ref) === undefined;
    const now = new Date().toISOString();
    upsertSession.run(
      session.session_ref,
      session.tool,
      session.source_session_id,
      projectRoot,
      session.git_branch,
      session.git_commit,
      session.started_at,
      session.last_activity_at,
      session.preview,
      session.source_path,
      now,
    );
    let messagesAdded = 0;
    for (const message of session.messages) {
      messagesAdded += insertMessage.run(
        message.id,
        session.session_ref,
        session.tool,
        session.source_session_id,
        message.timestamp,
        message.role,
        message.content,
        message.message_index,
        message.content_hash,
        message.metadata_json,
        message.source_pointer,
        now,
      ).changes;
    }
    return { created, messagesAdded };
  });
}

export interface CarryForwardResult {
  /** Sessions copied in, by ref. */
  copied: string[];
  /** Sessions the file names but whose rows could not be read. */
  unreadable: number;
  /** Set when nothing in the file could be read at all. */
  error?: string;
}

/**
 * Copy every session `target` lacks out of the database at `sourcePath`.
 *
 * For a set-aside index: the file was moved aside because it is corrupt or in
 * a shape nothing could migrate, and the index rebuilt from the transcripts
 * still on disk. Whatever the rebuild did not find there is what only the
 * set-aside file still holds, so "every session the new index lacks" is that
 * set exactly -- run after a full scan, never before.
 *
 * A damaged file is read for what it still yields: each session is read in its
 * own try, so one bad page costs the sessions on it rather than the rest.
 * Writes to `target` are deliberately outside that try. A failure there (a
 * lock held by another server) says nothing about the file, and counting it
 * as unreadable would have the caller record the file as done and never
 * return to sessions that were perfectly readable.
 *
 * Returns null when the file could not be opened for a reason that may pass,
 * so the caller tries again later instead of recording it as done.
 */
export function carryForwardSessions(
  target: DatabaseHandle,
  sourcePath: string,
): CarryForwardResult | null {
  // A read-only open of a WAL-mode file still creates `-wal` and `-shm`
  // beside it. Whichever of them this creates, it removes again on the way
  // out, so a set-aside file is left as it was found.
  const absentBefore = ["-wal", "-shm"].map((suffix) => `${sourcePath}${suffix}`).filter((side) => !existsSync(side));
  let source: DatabaseHandle;
  try {
    source = openForReading(sourcePath);
  } catch (error) {
    removeCreatedSideFiles(absentBefore);
    return isCorruptDatabaseError(error) ? { copied: [], unreadable: 0, error: messageOf(error) } : null;
  }

  try {
    let refs: string[];
    try {
      refs = source.prepare("SELECT session_ref FROM sessions").pluck().all() as string[];
    } catch (error) {
      // No sessions table, or its pages are what is damaged. Both are final.
      const code = (error as { code?: unknown } | null)?.code;
      if (isCorruptDatabaseError(error) || code === "SQLITE_ERROR") {
        return { copied: [], unreadable: 0, error: messageOf(error) };
      }
      return null;
    }

    const present = target.prepare("SELECT 1 FROM sessions WHERE session_ref = ?");
    const merge = createSessionMerger(target);
    const copied: string[] = [];
    let unreadable = 0;
    for (const ref of refs) {
      if (present.get(ref) !== undefined) {
        continue;
      }
      let session: ArchivedSession | null;
      try {
        session = readArchivedSession(source, ref);
      } catch {
        session = null;
      }
      if (session === null) {
        unreadable += 1;
        continue;
      }
      merge(session, session.project_root);
      copied.push(ref);
    }
    return { copied, unreadable };
  } finally {
    source.close();
    removeCreatedSideFiles(absentBefore);
  }
}

/** Only a `-wal` with nothing in it: one holding pages is not this reader's. */
function removeCreatedSideFiles(paths: string[]): void {
  for (const path of paths) {
    try {
      if (path.endsWith("-shm") || statSync(path).size === 0) {
        rmSync(path, { force: true });
      }
    } catch {
      // Not created after all, or already gone.
    }
  }
}

/**
 * Read-only first, so the file is left byte for byte as it was set aside. A
 * WAL file whose `-shm` did not travel with it cannot be opened read-only, and
 * for that one a normal open -- which replays the WAL into it -- is the only
 * way to read what the WAL holds.
 */
function openForReading(path: string): DatabaseHandle {
  let db: DatabaseHandle | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.prepare("SELECT COUNT(*) FROM sqlite_master").get();
    return db;
  } catch (error) {
    db?.close();
    if (isCorruptDatabaseError(error)) {
      throw error;
    }
    return new Database(path, { fileMustExist: true });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
