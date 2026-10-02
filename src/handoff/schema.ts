import Database from "better-sqlite3";
import type { Database as DatabaseHandle, Statement, Transaction } from "better-sqlite3";
import { PROJECT_ROOT_SQL, canonicalRoot, normalizeRootForCompare } from "./queries.js";

export interface PreparedStatements {
  upsertSession: Statement;
  insertMessage: Statement;
  upsertChunkTxn: Transaction<(sessionArgs: unknown[], messageArgs: unknown[]) => void>;
  sessionRollup: Statement;
  /** Repairs roll-ups a previous scan died before reaching. See its prepare. */
  reconcileSessionRollups: Statement;
  /**
   * Sessions whose retrieval units are missing or stale: marked stale by a
   * scan that wrote to them, or not reaching their last message.
   */
  selectSessionsNeedingUnits: Statement;
  /** Records that a session's units must be rebuilt; see `unitsStaleKey`. */
  markUnitsStale: Statement;
  /** Clears that record, once the units are rebuilt. */
  clearUnitsStale: Statement;
  selectSessionMessages: Statement;
  /**
   * The message ids a session held when a scan began: every row indexed at or
   * before a given time. See the prune in `scanTool` for why the time bound.
   */
  selectPrunableMessageIds: Statement;
  /** Whether a session holds a row at a position; the cursor check's probe. */
  messageAtIndex: Statement;
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
 * Bumped whenever the schema shape changes, together with a step in
 * `MIGRATIONS` that brings an index from the previous version up to it.
 *
 * Migrated in place, not rebuilt. An index from an older version used to be
 * set aside and rebuilt from the transcripts still on disk -- and before that,
 * deleted -- which silently dropped every session whose transcript had since
 * been cleaned up (Claude Code deletes them after 30 days by default). For
 * those sessions the index is the only copy, so a schema bump cost them on
 * every upgrade. Set-aside is now kept for a file that is corrupt, or older
 * but in a shape no step recognises; see SqliteHandoffIndex.
 *
 * One from a NEWER version is refused, because setting it aside would hide
 * history from the newer xtctx that wrote it -- two installed versions sharing
 * one index would each set the other's aside on every start.
 */
// 3: `project_root` is stored canonicalised and normalized, and every read
// filters on it. An index written by version 2 holds raw roots, which mostly
// still compare equal — but not where `realpath` differs, and there the rows
// go quiet rather than wrong. The scraper cursors would not re-add them, so
// the re-read has to be forced rather than waited for (see
// `MIGRATED_FROM_SETTING`).
const SCHEMA_VERSION = 3;

/**
 * Written by a migration, read and cleared by the index on open.
 *
 * A migration fixes the shape, not the rows: whatever an older build wrote is
 * still there as it wrote it. Clearing the scraper cursors makes the next scan
 * re-read every session still on disk, which is what refreshes those rows --
 * the job a rebuild used to do -- while sessions whose transcripts are gone
 * stay as they are. A setting rather than a return value so that a process
 * which dies between the migration and the cursor reset leaves the
 * instruction behind for the next one.
 */
export const MIGRATED_FROM_SETTING = "schema_migrated_from";

/** The index on disk was written by a schema version this build cannot use as it is. */
export class SchemaVersionError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
    /** Why an older index could not be migrated. */
    readonly reason?: string,
  ) {
    super(
      found > supported
        ? `xtctx index schema version ${found} is newer than this xtctx supports (${supported}); ` +
            "upgrade xtctx rather than rebuilding the index"
        : `xtctx index schema version ${found} could not be migrated to version ${supported}` +
            (reason ? `: ${reason}` : ""),
    );
    this.name = "SchemaVersionError";
  }

  get newer(): boolean {
    return this.found > this.supported;
  }
}

/**
 * `MIGRATIONS[n]` takes an index written at version n to version n + 1, in
 * place. After the last step, `createSchema` adds anything new that is a whole
 * table or index, and `assertCurrentShape` checks the result before the
 * version is stamped, so a step only has to change what already exists.
 *
 * Every step must be safe to run on a file that already has its change: an
 * index whose schema was created but whose version was never stamped (a
 * process killed between the two) reads as version 0 with every table
 * current.
 */
const MIGRATIONS: Record<number, (db: DatabaseHandle) => void> = {
  // 0 -> 1 (269fefb): the unversioned index wrote a `messages_fts` table that
  // nothing read, and keyed vectors on `unit_id` alone although each row
  // names its model. Those vectors were also built from only the first ~256
  // tokens of a window, which the same version fixed, so they are dropped
  // rather than carried: they are recomputed from the windows anyway.
  0: (db) => {
    db.exec("DROP TABLE IF EXISTS messages_fts");
    const keyColumns = (
      db.prepare("PRAGMA table_info(retrieval_unit_vectors)").all() as Array<{ pk: number }>
    ).filter((column) => column.pk > 0);
    if (keyColumns.length === 1) {
      db.exec("DROP TABLE retrieval_unit_vectors");
    }
  },
  // 1 -> 2 (#123): sessions record the git branch and commit they ran on.
  // Existing rows get NULL; the forced re-read fills them for every session
  // still on disk, and the upsert's COALESCE keeps them once set.
  1: (db) => {
    addColumnIfMissing(db, "sessions", "git_branch", "TEXT");
    addColumnIfMissing(db, "sessions", "git_commit", "TEXT");
  },
  // 2 -> 3 (#311): `project_root` is stored canonicalised. Rows written raw
  // are resolved the same way the index resolves the root it reads under, so
  // a session that is no longer on disk -- and so will never be re-read --
  // still lands under the name its project is read by.
  2: (db) => {
    const roots = db.prepare("SELECT DISTINCT project_root FROM sessions").pluck().all() as string[];
    const update = db.prepare("UPDATE sessions SET project_root = ? WHERE project_root = ?");
    for (const root of roots) {
      const canonical = normalizeRootForCompare(canonicalRoot(root));
      if (canonical !== root) {
        update.run(canonical, root);
      }
    }
  },
};

function columnNames(db: DatabaseHandle, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

function addColumnIfMissing(db: DatabaseHandle, table: string, column: string, type: string): void {
  if (!columnNames(db, table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Throw unless every table holds every column this build reads.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table exactly as it is, so
 * a file whose tables are not the shape its version number claims would
 * otherwise be stamped current and then fail at runtime with "no such
 * column". Compared against a schema created fresh, so there is no second
 * list of columns to keep in step with `createSchema`.
 */
function assertCurrentShape(db: DatabaseHandle, found: number): void {
  const reference = new Database(":memory:");
  try {
    createSchema(reference);
    for (const table of ["sessions", "messages", "retrieval_units", "retrieval_unit_vectors", "settings"]) {
      const have = new Set(columnNames(db, table));
      const missing = columnNames(reference, table).filter((column) => !have.has(column));
      if (missing.length > 0) {
        throw new SchemaVersionError(
          found,
          SCHEMA_VERSION,
          `its ${table} table has no ${missing.join(", ")}`,
        );
      }
    }
  } finally {
    reference.close();
  }
}

/**
 * Bring an older index up to `SCHEMA_VERSION`, in one transaction.
 *
 * `BEGIN IMMEDIATE`, and the version read again inside it: with one server
 * per MCP client, several processes open the same file at once, and whichever
 * takes the write lock second must find the work already done rather than
 * run it over a file that has moved on. A lock it cannot get within the busy
 * timeout surfaces as an ordinary lock error, which the index retries on the
 * next call without touching the file.
 *
 * A step that fails on SQL -- a table or column the history never had --
 * means the file is not what its version claims. That is reported as a
 * `SchemaVersionError` for an older version, which sets it aside; everything
 * else (corruption, a lock) is rethrown as it is so it is handled as that.
 * The transaction rolls back either way, so a file is set aside as it was
 * found, not half-migrated.
 */
function migrateSchema(db: DatabaseHandle): void {
  db.transaction(() => {
    const found = db.pragma("user_version", { simple: true }) as number;
    if (found === SCHEMA_VERSION) {
      return;
    }
    if (found > SCHEMA_VERSION) {
      throw new SchemaVersionError(found, SCHEMA_VERSION);
    }
    try {
      for (let version = found; version < SCHEMA_VERSION; version += 1) {
        const step = MIGRATIONS[version];
        if (!step) {
          throw new SchemaVersionError(found, SCHEMA_VERSION, `no migration from version ${version}`);
        }
        step(db);
      }
      createSchema(db);
      assertCurrentShape(db, found);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "SQLITE_ERROR") {
        throw new SchemaVersionError(
          found,
          SCHEMA_VERSION,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
    setSetting(db, MIGRATED_FROM_SETTING, String(found));
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }).immediate();
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
    if (objectCount > 0 && version > SCHEMA_VERSION) {
      throw new SchemaVersionError(version, SCHEMA_VERSION);
    }
    if (objectCount > 0 && version < SCHEMA_VERSION) {
      migrateSchema(db);
      return db;
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

  const selectPrunableMessageIds = db.prepare(
    `SELECT id FROM messages WHERE session_ref = ? AND indexed_at <= ?`,
  );
  const messageAtIndex = db.prepare(
    `SELECT 1 FROM messages WHERE session_ref = ? AND message_index = ? LIMIT 1`,
  );
  const deleteMessageById = db.prepare(`DELETE FROM messages WHERE id = ?`);
  const minMessageIndexForSession = db.prepare(
    `SELECT MIN(message_index) AS lowest FROM messages WHERE session_ref = ?`,
  );

  return {
    upsertSession,
    insertMessage,
    selectPrunableMessageIds,
    messageAtIndex,
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
     * Sessions whose windows are missing or out of date, most recent first.
     *
     * Two signals, because each misses what the other catches. A scan marks
     * every session it writes to before writing (`markUnitsStale`) and the
     * rebuild clears the mark, so a scan cut off in between leaves the mark
     * behind — including where a turn was replaced at a position the windows
     * already reach, which no comparison of positions can see. The coverage
     * check covers indexes written before the marks existed: windows that
     * stop short of the session's last message. On a healthy index both find
     * nothing, and this costs one indexed pass over the project's sessions.
     */
    selectSessionsNeedingUnits: db.prepare(
      `SELECT s.session_ref
       FROM sessions s
       WHERE ${PROJECT_ROOT_SQL.replace("project_root", "s.project_root")} = ?
         AND (
           EXISTS (SELECT 1 FROM settings st WHERE st.key = '${UNITS_STALE_PREFIX}' || s.session_ref)
           OR COALESCE(
                (SELECT MAX(u.message_end_index) FROM retrieval_units u
                 WHERE u.session_ref = s.session_ref), -1
              ) < COALESCE(
                (SELECT MAX(m.message_index) FROM messages m
                 WHERE m.session_ref = s.session_ref), -1
              )
         )
       ORDER BY s.last_activity_at DESC`,
    ),
    markUnitsStale: db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`),
    clearUnitsStale: db.prepare(`DELETE FROM settings WHERE key = ?`),
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

/** Prefix of the `settings` keys that mark a session's units stale. */
const UNITS_STALE_PREFIX = "units_stale:";

/** The `settings` key marking one session's retrieval units as needing a rebuild. */
export function unitsStaleKey(sessionRef: string): string {
  return `${UNITS_STALE_PREFIX}${sessionRef}`;
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
