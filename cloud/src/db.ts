import type { Env, AuthUser, StreamTurnDelta, SessionRecord, MessageRecord } from "./types.js";

/**
 * Atomically ingest a stream turn delta from an agent device into Cloudflare D1.
 */
export async function ingestTurnDelta(
  env: Env,
  user: AuthUser,
  delta: StreamTurnDelta
): Promise<{ success: boolean; sessionRef: string }> {
  const sessionRef = `${user.userId}:${delta.tool}:${delta.sourceSessionId}`;
  const now = new Date().toISOString();
  const nowTs = Date.now();

  const statements: D1PreparedStatement[] = [];

  // 1. Ensure user and device records exist/updated
  statements.push(
    env.DB.prepare(
      `INSERT INTO users (id, username, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    ).bind(user.userId, user.username, nowTs, nowTs)
  );

  const deviceName = delta.deviceName || delta.deviceId;
  statements.push(
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, device_name, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
    ).bind(delta.deviceId, user.userId, deviceName, nowTs, nowTs)
  );

  // 2. Upsert session
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
      delta.deviceId,
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

  // 3. Insert message turn
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

  await env.DB.batch(statements);

  return { success: true, sessionRef };
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
