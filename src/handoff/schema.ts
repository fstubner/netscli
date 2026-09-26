import Database from "better-sqlite3";
import type { Database as DatabaseHandle, Statement, Transaction } from "better-sqlite3";
import { PROJECT_ROOT_SQL } from "./queries.js";

export interface PreparedStatements {
  upsertSession: Statement;
  insertMessage: Statement;
  upsertChunkTxn: Transaction<(sessionArgs: unknown[], messageArgs: unknown[]) => void>;
  sessionRollup: Statement;
  /** Repairs roll-ups a previous scan died before reaching. See its prepare. */
  reconcileSessionRollups: Statement;
  /** Sessions whose retrieval units do not reach their last message. */
  selectSessionsMissingUnits: Statement;
  selectSessionMessages: Statement;
  /** Every message id a session currently holds; see the prune in `scanTool`. */
  selectMessageIdsForSession: Statement;
  /**
   * The lowest position a session already holds, read before this scan writes
   * to it. A scan that reaches at least that far back has accounted for
   * everything from there on; see `pruneRereadSessions`.
   */
  minMessageIndexForSession: Statement;
  /** Removes one message a re-read of its session did not produce. */
  deleteMessageById: Statement;
  messageOffsetInSession: Statement;
  selectSessionTool: Statement;
  selectUnitIds: Statement;
  insertUnit: Statement;
  insertUnitFts: Statement;
  deleteUnit: Statement;
}

export interface CountRow {
  count: number;
}

/**
 * Bumped whenever the schema shape changes. There are no migrations: an index
 * from an OLDER version is set aside and rebuilt (see SqliteHandoffIndex), and
 * one from a NEWER version is refused, because setting it aside would hide
 * history from the newer xtctx that wrote it -- two installed versions sharing
 * one index would each set the other's aside on every start.
 */
// 3: `project_root` is stored canonicalised and normalized, and every read
// filters on it. An index written by version 2 holds raw roots, which mostly
// still compare equal — but not where `realpath` differs, and there the rows
// go quiet rather than wrong. The scraper cursors would not re-add them, so
// the rebuild has to be forced rather than waited for.
const SCHEMA_VERSION = 3;

/** The index on disk was written by a different schema version. */
export class SchemaVersionError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      found > supported
        ? `xtctx index schema version ${found} is newer than this xtctx supports (${supported}); ` +
            "upgrade xtctx rather than rebuilding the index"
        : `xtctx index schema version ${found} does not match supported version ${supported}`,
    );
    this.name = "SchemaVersionError";
  }

  get newer(): boolean {
    return this.found > this.supported;
  }
}

/**
 * True for an error that means the file itself is unusable -- not a SQLite
 * database, or damaged -- as opposed to one that says nothing about the file:
 * a lock held by another xtctx server, a permission, a full disk.
 */
export function isCorruptDatabaseError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && (code === "SQLITE_NOTADB" || code.startsWith("SQLITE_CORRUPT"));
}

export function openDatabase(dbPath: string): DatabaseHandle {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const objectCount = (
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master").get() as CountRow
    ).count;
    const version = db.pragma("user_version", { simple: true }) as number;
    if (objectCount > 0 && version !== SCHEMA_VERSION) {
      throw new SchemaVersionError(version, SCHEMA_VERSION);
    }
    createSchema(db);
    // Only when it changes. Writing it on every open took the write lock, so
    // with one server per MCP client an ordinary open waited out the busy
    // timeout behind another server's write and then failed.
    if (version !== SCHEMA_VERSION) {
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function createSchema(db: DatabaseHandle): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_ref TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      git_branch TEXT,
      git_commit TEXT,
      started_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      preview TEXT,
      source_path TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_ref TEXT NOT NULL REFERENCES sessions(session_ref) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      source_pointer TEXT,
      indexed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_order
      ON messages(session_ref, timestamp, message_index, id);

    CREATE TABLE IF NOT EXISTS retrieval_units (
      id TEXT PRIMARY KEY,
      session_ref TEXT NOT NULL REFERENCES sessions(session_ref) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      message_start_index INTEGER NOT NULL,
      message_end_index INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_retrieval_units_session
      ON retrieval_units(session_ref, message_start_index, message_end_index);
    CREATE INDEX IF NOT EXISTS idx_retrieval_units_tool_time
      ON retrieval_units(tool, ended_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_units_fts
      USING fts5(unit_id UNINDEXED, session_ref UNINDEXED, tool UNINDEXED, content);

    CREATE TABLE IF NOT EXISTS retrieval_unit_vectors (
      unit_id TEXT NOT NULL REFERENCES retrieval_units(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (unit_id, model)
    );

    CREATE INDEX IF NOT EXISTS idx_retrieval_unit_vectors_model
      ON retrieval_unit_vectors(model);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function prepareStatements(db: DatabaseHandle): PreparedStatements {
  const upsertSession = db.prepare(
    `INSERT INTO sessions
     (session_ref, tool, source_session_id, project_root, git_branch, git_commit,
      started_at, last_activity_at, message_count, preview, source_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(session_ref) DO UPDATE SET
       started_at = CASE
         WHEN excluded.started_at < started_at THEN excluded.started_at
         ELSE started_at
       END,
       last_activity_at = CASE
         WHEN excluded.last_activity_at > last_activity_at THEN excluded.last_activity_at
         ELSE last_activity_at
       END,
       -- First non-null wins: a session keeps the branch it started on
       -- even if later records omit it.
       git_branch = COALESCE(git_branch, excluded.git_branch),
       git_commit = COALESCE(git_commit, excluded.git_commit),
       source_path = COALESCE(source_path, excluded.source_path),
       -- Overwritten, not preserved. A row was pinned forever to whatever
       -- root it was first written under, so renaming or moving a project
       -- directory left its whole history filtered out of every read while
       -- the rows sat intact in the table. This upsert only runs because a
       -- scraper just attributed this session to *this* project, so taking
       -- the new root is the same decision the insert would make.
       project_root = excluded.project_root,
       updated_at = excluded.updated_at`,
  );
  const insertMessage = db.prepare(
    `INSERT OR IGNORE INTO messages
     (id, session_ref, tool, source_session_id, timestamp, role, content,
      message_index, content_hash, metadata_json, source_pointer, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const selectMessageIdsForSession = db.prepare(`SELECT id FROM messages WHERE session_ref = ?`);
  const deleteMessageById = db.prepare(`DELETE FROM messages WHERE id = ?`);
  const minMessageIndexForSession = db.prepare(
    `SELECT MIN(message_index) AS lowest FROM messages WHERE session_ref = ?`,
  );

  return {
    upsertSession,
    insertMessage,
    selectMessageIdsForSession,
    deleteMessageById,
    minMessageIndexForSession,
    upsertChunkTxn: db.transaction((sessionArgs: unknown[], messageArgs: unknown[]) => {
      upsertSession.run(...sessionArgs);
      insertMessage.run(...messageArgs);
    }),
    sessionRollup: db.prepare(
      `UPDATE sessions
       SET message_count = (
             SELECT COUNT(*) FROM messages WHERE messages.session_ref = sessions.session_ref
           ),
           preview = COALESCE(
             (
               SELECT substr(content, 1, 240)
               FROM messages
               WHERE messages.session_ref = sessions.session_ref
               ORDER BY timestamp ASC, message_index ASC, id ASC
               LIMIT 1
             ),
             preview
           )
       WHERE session_ref = ?`,
    ),
    /**
     * Repair sessions whose stored roll-up disagrees with their messages.
     *
     * The per-session roll-up above runs once per scan, after every scraper
     * has finished — but each scraper advances its own cursor as soon as it
     * finishes. Between those two points the messages are committed and the
     * store will not be re-read, so a process that dies in the gap leaves the
     * session reporting zero messages permanently, with its content still
     * fully retrievable. Re-ingesting cannot fix that; only reconciling
     * against what is already stored can.
     *
     * The WHERE clause is what keeps this cheap: rows that agree are not
     * written, so a healthy index pays a single indexed COUNT per session and
     * dirties nothing. `idx_messages_session_order` leads with `session_ref`,
     * so each count is index-served rather than a table scan.
     */
    reconcileSessionRollups: db.prepare(
      `UPDATE sessions
       SET message_count = (
             SELECT COUNT(*) FROM messages WHERE messages.session_ref = sessions.session_ref
           ),
           preview = COALESCE(
             (
               SELECT substr(content, 1, 240)
               FROM messages
               WHERE messages.session_ref = sessions.session_ref
               ORDER BY timestamp ASC, message_index ASC, id ASC
               LIMIT 1
             ),
             preview
           )
       WHERE message_count <> (
         SELECT COUNT(*) FROM messages WHERE messages.session_ref = sessions.session_ref
       )`,
    ),
    /**
     * Sessions whose windows stop short of their last message.
     *
     * `MAX(message_end_index)` against `MAX(message_index)` is exact rather
     * than approximate: on a healthy index every session reports a gap of
     * zero, so this returns nothing and the scan pays one indexed pass.
     * Ordered by recency because the repair is bounded per scan.
     */
    selectSessionsMissingUnits: db.prepare(
      `SELECT s.session_ref
       FROM sessions s
       WHERE ${PROJECT_ROOT_SQL.replace("project_root", "s.project_root")} = ?
         AND COALESCE(
               (SELECT MAX(u.message_end_index) FROM retrieval_units u
                WHERE u.session_ref = s.session_ref), -1
             ) < COALESCE(
               (SELECT MAX(m.message_index) FROM messages m
                WHERE m.session_ref = s.session_ref), -1
             )
       ORDER BY s.last_activity_at DESC
       LIMIT ?`,
    ),
    selectSessionMessages: db.prepare(
      `SELECT id, timestamp, role, content, message_index, source_pointer
       FROM messages
       WHERE session_ref = ?
       ORDER BY timestamp ASC, message_index ASC, id ASC`,
    ),
    /**
     * How many messages of a session sort before a given `message_index`.
     *
     * `getSessionDetail` pages by POSITION — `LIMIT ? OFFSET ?` over this
     * same ordering — while a retrieval unit records the `message_index`
     * values at its edges. Those two coincide only while a session's
     * numbering is dense and monotonic in timestamp order, and real
     * transcripts are neither: one session here carries 828 duplicate
     * messages and 862 places where index order disagrees with time order,
     * which is what made a match point somewhere unrelated.
     *
     * The ordering below is character-for-character the one
     * `selectSessionMessages` and `getSessionDetail` use. If any of the
     * three changes, all three must.
     */
    messageOffsetInSession: db.prepare(
      // `LIMIT 1`, because `message_index` is not unique — the 828 duplicates
      // named above are in one real session. Without it the CTE returns a row
      // per duplicate and `FROM messages m, target t` cross-joins every one,
      // multiplying the count by however many duplicates there are. Measured
      // on six messages with `message_index = 3` on three of them: offset 12
      // for a session holding 6 rows, so `getSessionDetail` paged past the end
      // and returned nothing — which is the "match points somewhere
      // unrelated" failure this statement exists to prevent, in its worst
      // form. The ordering picks the same first row the two statements above
      // would.
      `WITH target AS (
         SELECT timestamp, message_index, id FROM messages
          WHERE session_ref = ? AND message_index = ?
          ORDER BY timestamp ASC, message_index ASC, id ASC
          LIMIT 1
       )
       SELECT COUNT(*) AS count
         FROM messages m, target t
        WHERE m.session_ref = ?
          AND (m.timestamp < t.timestamp
            OR (m.timestamp = t.timestamp AND m.message_index < t.message_index)
            OR (m.timestamp = t.timestamp AND m.message_index = t.message_index
                AND m.id < t.id))`,
    ),
    selectSessionTool: db.prepare("SELECT tool FROM sessions WHERE session_ref = ?"),
    selectUnitIds: db.prepare("SELECT id FROM retrieval_units WHERE session_ref = ?"),
    insertUnit: db.prepare(
      `INSERT INTO retrieval_units
       (id, session_ref, tool, message_start_index, message_end_index,
        started_at, ended_at, content, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertUnitFts: db.prepare(
      `INSERT INTO retrieval_units_fts(unit_id, session_ref, tool, content)
       VALUES (?, ?, ?, ?)`,
    ),
    deleteUnit: db.prepare("DELETE FROM retrieval_units WHERE id = ?"),
  };
}

export function placeholders(countValue: number): string {
  return Array.from({ length: countValue }, () => "?").join(", ");
}

export function getSetting(db: DatabaseHandle, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DatabaseHandle, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings(key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function clearSetting(db: DatabaseHandle, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
