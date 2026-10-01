import type { Env, AuthUser, StreamTurnDelta, SessionRecord, MessageRecord } from "./types.js";

/**
 * Atomically ingest a stream turn delta from an agent device into Cloudflare D1.
 */
export async function ingestTurnDelta(
  env: Env,
  user: AuthUser,
  input: StreamTurnDelta | StreamTurnDelta[]
): Promise<{ success: boolean; count: number; sessionRef?: string }> {
  const deltas = Array.isArray(input) ? input : [input];
  if (deltas.length === 0) {
    return { success: true, count: 0 };
  }

  const now = new Date().toISOString();
  const nowTs = Date.now();
  const statements: D1PreparedStatement[] = [];

  for (const delta of deltas) {
    const sessionRef = `${user.userId}:${delta.tool}:${delta.sourceSessionId}`;
    const deviceName = delta.deviceName || delta.deviceId;
    // Device ids come from the client and are the table's primary key, so two
    // users picking the same one would otherwise share a row. Scoped to the user.
    const deviceId = `${user.userId}:${delta.deviceId}`;

    statements.push(
      env.DB.prepare(
        `INSERT INTO devices (id, user_id, device_name, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
      ).bind(deviceId, user.userId, deviceName, nowTs, nowTs)
    );

    statements.push(
      env.DB.prepare(
        `INSERT INTO sessions (
           session_ref, user_id, device_id, tool, source_session_id,
           repo_url, project_root, git_branch, git_commit,
           started_at, last_activity_at, message_count, preview, source_path, status, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(session_ref) DO UPDATE SET
           last_activity_at = excluded.last_activity_at,
           message_count = message_count + 1,
           preview = COALESCE(excluded.preview, preview),
           status = excluded.status,
           updated_at = excluded.updated_at`
      ).bind(
        sessionRef,
        user.userId,
        deviceId,
        delta.tool,
        delta.sourceSessionId,
        delta.repoUrl,
        delta.projectRoot,
        delta.gitBranch || null,
        delta.gitCommit || null,
        delta.timestamp,
        delta.timestamp,
        delta.preview || (delta.content ? delta.content.slice(0, 160) : null),
        delta.sourcePointer || null,
        delta.status || "active",
        now
      )
    );

    const messageId = `${sessionRef}:${delta.messageIndex}:${delta.contentHash.slice(0, 8)}`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO messages (
           id, session_ref, tool, source_session_id, timestamp, role,
           content, message_index, content_hash, metadata_json, source_pointer, indexed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      ).bind(
        messageId,
        sessionRef,
        delta.tool,
        delta.sourceSessionId,
        delta.timestamp,
        delta.role,
        delta.content,
        delta.messageIndex,
        delta.contentHash,
        delta.metadataJson || "{}",
        delta.sourcePointer || null,
        now
      )
    );
  }

  // D1 batch execution in chunks of 100 statements
  const CHUNK_SIZE = 100;
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const chunk = statements.slice(i, i + CHUNK_SIZE);
    await env.DB.batch(chunk);
  }

  const lastSessionRef = `${user.userId}:${deltas[deltas.length - 1].tool}:${deltas[deltas.length - 1].sourceSessionId}`;
  return { success: true, count: deltas.length, sessionRef: lastSessionRef };
}

/**
 * Fetch recent sessions for a user, optionally filtered by git repo URL or branches.
 */
export async function getRecentSessions(
  env: Env,
  userId: string,
  options: {
    repoUrl?: string;
    branchFilter?: string[];
    toolFilter?: string[];
    limit?: number;
  }
): Promise<SessionRecord[]> {
  const limit = Math.min(options.limit || 5, 25);
  let query = `SELECT * FROM sessions WHERE user_id = ?`;
  const bindings: unknown[] = [userId];

  if (options.repoUrl) {
    query += ` AND repo_url = ?`;
    bindings.push(options.repoUrl);
  }

  if (options.toolFilter && options.toolFilter.length > 0) {
    const placeholders = options.toolFilter.map(() => "?").join(", ");
    query += ` AND tool IN (${placeholders})`;
    bindings.push(...options.toolFilter);
  }

  if (options.branchFilter && options.branchFilter.length > 0) {
    const placeholders = options.branchFilter.map(() => "?").join(", ");
    query += ` AND git_branch IN (${placeholders})`;
    bindings.push(...options.branchFilter);
  }

  query += ` ORDER BY last_activity_at DESC LIMIT ?`;
  bindings.push(limit);

  const result = await env.DB.prepare(query).bind(...bindings).all<SessionRecord>();
  return result.results || [];
}

/**
 * Fetch messages for a specific session.
 */
export async function getSessionMessages(
  env: Env,
  userId: string,
  sessionRef: string,
  options: { offset?: number; limit?: number } = {}
): Promise<{ session: SessionRecord | null; messages: MessageRecord[] }> {
  const session = await env.DB.prepare(
    `SELECT * FROM sessions WHERE session_ref = ? AND user_id = ?`
  ).bind(sessionRef, userId).first<SessionRecord>();

  if (!session) {
    return { session: null, messages: [] };
  }

  const offset = options.offset || 0;
  const limit = Math.min(options.limit || 50, 100);

  const messagesResult = await env.DB.prepare(
    `SELECT * FROM messages 
     WHERE session_ref = ? 
     ORDER BY message_index ASC 
     LIMIT ? OFFSET ?`
  ).bind(sessionRef, limit, offset).all<MessageRecord>();

  return {
    session,
    messages: messagesResult.results || [],
  };
}

const ROLES = new Set(["user", "assistant", "system", "tool"]);
const MAX_BATCH = 200;

/**
 * Validate an ingest body. Returns null for anything malformed, so a bad
 * request is a 400 and never reaches a query.
 */
export function parseTurnDeltas(input: unknown): StreamTurnDelta[] | null {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0 || list.length > MAX_BATCH) return null;

  const text = (v: unknown) => typeof v === "string" && v.length > 0;
  for (const d of list as Record<string, unknown>[]) {
    if (typeof d !== "object" || d === null) return null;
    if (
      !text(d.deviceId) || !text(d.tool) || !text(d.sourceSessionId) || !text(d.repoUrl) ||
      !text(d.projectRoot) || !text(d.timestamp) || !text(d.contentHash) ||
      typeof d.content !== "string" || !ROLES.has(d.role as string) ||
      !Number.isInteger(d.messageIndex)
    ) {
      return null;
    }
  }
  return list as StreamTurnDelta[];
}

export async function upsertUser(env: Env, userId: string, username: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at`
  ).bind(userId, username, now, now).run();
}

/** The user's current token version, or null when there is no such user. */
export async function getTokenVersion(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT token_version FROM users WHERE id = ?`)
    .bind(userId).first<{ token_version: number }>();
  return row ? row.token_version : null;
}

/** Invalidate every token issued to this user so far. */
export async function bumpTokenVersion(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).bind(userId).run();
}

/**
 * Remove everything held for a user, children first, then the account row.
 * With the row gone no token for it authenticates, so this also signs the user
 * out everywhere.
 */
export async function deleteUserData(env: Env, userId: string): Promise<void> {
  const owned = `(SELECT session_ref FROM sessions WHERE user_id = ?)`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM retrieval_units WHERE session_ref IN ${owned}`).bind(userId),
    env.DB.prepare(`DELETE FROM messages WHERE session_ref IN ${owned}`).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM devices WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}
