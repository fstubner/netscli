import type { Env, AuthUser, SessionRecord, MessageRecord } from "./types.js";

/**
 * Limits on what one upload may carry.
 *
 * Every session in a request is written in ONE D1 batch, so a request is
 * all-or-nothing. The numbers keep that batch inside D1's limits: messages go
 * in as one JSON parameter per session (a bound value may be up to 2 MB, and
 * the body cap keeps every one well under), and the statement count stays
 * under the 50 queries a Worker invocation may make on the free plan
 * (at most 4 per session + 2 in the batch, and 2 reads around it; see
 * `ingestUpload`).
 */
export const LIMITS = {
  /** Whole request body, bytes. */
  maxBodyBytes: 1024 * 1024,
  /** One message's `content`, UTF-8 bytes. The client truncates to fit with a marker. */
  maxMessageBytes: 64 * 1024,
  /** One message's `metadataJson`, bytes. */
  maxMetadataBytes: 4 * 1024,
  maxSessionsPerRequest: 10,
  maxMessagesPerRequest: 500,
} as const;

const ROLES = new Set(["user", "assistant", "system", "tool"]);
const TOOL_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LOCAL_ID = /^[0-9a-f]{16,64}$/;

export interface UploadMessage {
  /** The uploading index's own message id; the cloud id is `${sessionRef}:${id}`. */
  id: string;
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  messageIndex: number;
  contentHash: string;
  metadataJson: string;
}

export interface UploadSession {
  tool: string;
  sourceSessionId: string;
  gitBranch: string | null;
  gitCommit: string | null;
  startedAt: string;
  lastActivityAt: string;
  preview: string | null;
  messages: UploadMessage[];
  /**
   * The complete set of this session's message ids, when the client sends it.
   * Every stored message of the session not in it is deleted, in the same
   * batch, so the cloud copy ends up exactly the local one.
   */
  keepIds?: string[];
}

export interface UploadBody {
  device: { id: string; name: string };
  project: { repoUrl: string; name: string };
  sessions: UploadSession[];
}

export type ParseResult =
  | { ok: true; body: UploadBody }
  | { ok: false; status: 400 | 413 | 426; error: Record<string, unknown> };

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/**
 * Validate an upload body. Anything malformed is a 400 that never reaches a
 * query; anything over a limit is a 413 that names the message, so the client
 * can skip exactly that message and carry on.
 */
export function parseUpload(input: unknown): ParseResult {
  const bad = (detail: string): ParseResult => ({ ok: false, status: 400, error: { error: "invalid_request", detail } });
  // The body of every client before this version: a flat list of turns.
  if (Array.isArray(input)) {
    return { ok: false, status: 426, error: { error: "client_outdated", detail: "Update xtctx: this server takes the v2 upload format." } };
  }
  if (!isObject(input)) return bad("body must be an object");

  const text = (v: unknown, max = 512): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
  const optionalText = (v: unknown, max = 512) => v === undefined || v === null || text(v, max);

  const { device, project, sessions } = input;
  if (!isObject(device) || !text(device.id, 128) || !text(device.name, 128)) return bad("device");
  if (!isObject(project) || !text(project.repoUrl, 512) || !text(project.name, 256)) return bad("project");
  if (!Array.isArray(sessions) || sessions.length > LIMITS.maxSessionsPerRequest) return bad("sessions");

  let messageTotal = 0;
  const out: UploadSession[] = [];
  for (const s of sessions) {
    if (!isObject(s)) return bad("session");
    if (!text(s.tool, 40) || !TOOL_ID.test(s.tool) || !text(s.sourceSessionId, 256)) return bad("session id");
    if (!text(s.startedAt, 64) || !text(s.lastActivityAt, 64)) return bad("session times");
    if (!optionalText(s.gitBranch) || !optionalText(s.gitCommit) || !optionalText(s.preview, 4096)) return bad("session fields");
    if (!Array.isArray(s.messages)) return bad("messages");
    messageTotal += s.messages.length;
    if (messageTotal > LIMITS.maxMessagesPerRequest) return bad("too many messages in one request");

    const messages: UploadMessage[] = [];
    for (const m of s.messages) {
      if (!isObject(m)) return bad("message");
      if (!text(m.id, 64) || !LOCAL_ID.test(m.id)) return bad("message id");
      if (!text(m.timestamp, 64) || !ROLES.has(m.role as string) || typeof m.content !== "string") return bad("message fields");
      if (!Number.isInteger(m.messageIndex) || !text(m.contentHash, 128)) return bad("message fields");
      const metadataJson = m.metadataJson === undefined ? "{}" : m.metadataJson;
      if (typeof metadataJson !== "string") return bad("metadataJson");
      if (byteLength(m.content) > LIMITS.maxMessageBytes || byteLength(metadataJson) > LIMITS.maxMetadataBytes) {
        return {
          ok: false,
          status: 413,
          error: {
            error: "message_too_large",
            limit: LIMITS.maxMessageBytes,
            tool: s.tool,
            sourceSessionId: s.sourceSessionId,
            messageId: m.id,
          },
        };
      }
      messages.push({
        id: m.id,
        timestamp: m.timestamp as string,
        role: m.role as UploadMessage["role"],
        content: m.content,
        messageIndex: m.messageIndex as number,
        contentHash: m.contentHash as string,
        metadataJson,
      });
    }

    let keepIds: string[] | undefined;
    if (s.keepIds !== undefined) {
      if (!Array.isArray(s.keepIds) || !s.keepIds.every((id) => typeof id === "string" && LOCAL_ID.test(id))) {
        return bad("keepIds");
      }
      keepIds = s.keepIds as string[];
    }

    out.push({
      tool: s.tool,
      sourceSessionId: s.sourceSessionId,
      gitBranch: (s.gitBranch as string | undefined) ?? null,
      gitCommit: (s.gitCommit as string | undefined) ?? null,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      preview: typeof s.preview === "string" ? s.preview.slice(0, 160) : null,
      messages,
      keepIds,
    });
  }

  return {
    ok: true,
    body: {
      device: { id: device.id as string, name: device.name as string },
      project: { repoUrl: project.repoUrl as string, name: project.name as string },
      sessions: out,
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sessionRefFor(userId: string, tool: string, sourceSessionId: string): string {
  return `${userId}:${tool}:${sourceSessionId}`;
}

export interface IngestResult {
  success: true;
  sessions: Array<{ tool: string; sourceSessionId: string; messageCount: number }>;
}

/**
 * Write one upload as a single D1 batch: every session in it, or none.
 *
 * Idempotent: messages are keyed by the client's own message id, so a replay
 * rewrites the same rows, and `message_count` is recounted from the rows
 * rather than incremented. A session's `keepIds`, when sent, deletes every
 * stored message not in it, which is how a local re-read that removed or
 * replaced messages reaches the cloud.
 */
export async function ingestUpload(
  env: Env,
  user: AuthUser,
  body: UploadBody,
  clientVersion: string | null,
): Promise<IngestResult> {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  // Device ids come from the client and are the table's primary key, so two
  // users picking the same one would otherwise share a row. Scoped to the user.
  const deviceId = `${user.userId}:${body.device.id}`;
  const statements: D1PreparedStatement[] = [];

  statements.push(
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, device_name, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET device_name = excluded.device_name, last_seen_at = excluded.last_seen_at
       WHERE devices.user_id = excluded.user_id`,
    ).bind(deviceId, user.userId, body.device.name, nowMs, nowMs),
  );

  const refs: string[] = [];
  for (const s of body.sessions) {
    const sessionRef = sessionRefFor(user.userId, s.tool, s.sourceSessionId);
    refs.push(sessionRef);

    // Earliest start, latest activity, newest known branch: a replay or an
    // out-of-order upload can only move these forward.
    statements.push(
      env.DB.prepare(
        `INSERT INTO sessions (
           session_ref, user_id, device_id, tool, source_session_id, repo_url, project_root,
           git_branch, git_commit, started_at, last_activity_at, message_count, preview, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(session_ref) DO UPDATE SET
           device_id = excluded.device_id,
           repo_url = excluded.repo_url,
           project_root = excluded.project_root,
           git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
           git_commit = COALESCE(excluded.git_commit, sessions.git_commit),
           started_at = MIN(sessions.started_at, excluded.started_at),
           last_activity_at = MAX(sessions.last_activity_at, excluded.last_activity_at),
           preview = COALESCE(excluded.preview, sessions.preview),
           updated_at = excluded.updated_at
         WHERE sessions.user_id = excluded.user_id`,
      ).bind(
        sessionRef,
        user.userId,
        deviceId,
        s.tool,
        s.sourceSessionId,
        body.project.repoUrl,
        body.project.name,
        s.gitBranch,
        s.gitCommit,
        s.startedAt,
        s.lastActivityAt,
        s.preview,
        nowIso,
      ),
    );

    if (s.messages.length > 0) {
      // One statement for the whole session, however many messages: they
      // travel as a single JSON parameter.
      statements.push(
        env.DB.prepare(
          `INSERT INTO messages (
             id, session_ref, tool, source_session_id, timestamp, role, content,
             message_index, content_hash, metadata_json, indexed_at
           )
           SELECT ? || ':' || json_extract(value, '$.id'), ?, ?, ?,
                  json_extract(value, '$.timestamp'), json_extract(value, '$.role'),
                  json_extract(value, '$.content'), json_extract(value, '$.messageIndex'),
                  json_extract(value, '$.contentHash'), json_extract(value, '$.metadataJson'), ?
           FROM json_each(?) WHERE true
           ON CONFLICT(id) DO UPDATE SET
             timestamp = excluded.timestamp,
             role = excluded.role,
             content = excluded.content,
             message_index = excluded.message_index,
             content_hash = excluded.content_hash,
             metadata_json = excluded.metadata_json`,
        ).bind(sessionRef, sessionRef, s.tool, s.sourceSessionId, nowIso, JSON.stringify(s.messages)),
      );
    }

    if (s.keepIds) {
      statements.push(
        env.DB.prepare(
          `DELETE FROM messages
           WHERE session_ref = ?
             AND id NOT IN (SELECT ? || ':' || value FROM json_each(?))`,
        ).bind(sessionRef, sessionRef, JSON.stringify(s.keepIds)),
      );
    }

    statements.push(
      env.DB.prepare(
        `UPDATE sessions
         SET message_count = (SELECT COUNT(*) FROM messages WHERE messages.session_ref = sessions.session_ref)
         WHERE session_ref = ? AND user_id = ?`,
      ).bind(sessionRef, user.userId),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO uploads (user_id, device_id, repo_url, project_name, last_upload_at, client_version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_id, repo_url) DO UPDATE SET
         project_name = excluded.project_name,
         last_upload_at = excluded.last_upload_at,
         client_version = excluded.client_version`,
    ).bind(user.userId, deviceId, body.project.repoUrl, body.project.name, nowIso, clientVersion),
  );

  await env.DB.batch(statements);

  if (refs.length === 0) return { success: true, sessions: [] };
  const counted = await env.DB.prepare(
    `SELECT tool, source_session_id, message_count FROM sessions
     WHERE user_id = ? AND session_ref IN (SELECT value FROM json_each(?))`,
  )
    .bind(user.userId, JSON.stringify(refs))
    .all<{ tool: string; source_session_id: string; message_count: number }>();
  return {
    success: true,
    sessions: (counted.results ?? []).map((r) => ({
      tool: r.tool,
      sourceSessionId: r.source_session_id,
      messageCount: r.message_count,
    })),
  };
}

/** Sessions for a user, newest first, with the name of the device that uploaded each. */
export async function getRecentSessions(
  env: Env,
  userId: string,
  options: { repoUrl?: string; branchFilter?: string[]; toolFilter?: string[]; limit: number },
): Promise<SessionRecord[]> {
  let query = `SELECT s.*, d.device_name FROM sessions s LEFT JOIN devices d ON d.id = s.device_id WHERE s.user_id = ?`;
  const bindings: unknown[] = [userId];

  if (options.repoUrl) {
    query += ` AND s.repo_url = ?`;
    bindings.push(options.repoUrl);
  }
  if (options.toolFilter && options.toolFilter.length > 0) {
    query += ` AND s.tool IN (${options.toolFilter.map(() => "?").join(", ")})`;
    bindings.push(...options.toolFilter);
  }
  if (options.branchFilter && options.branchFilter.length > 0) {
    query += ` AND s.git_branch IN (${options.branchFilter.map(() => "?").join(", ")})`;
    bindings.push(...options.branchFilter);
  }
  query += ` ORDER BY s.last_activity_at DESC, s.session_ref ASC LIMIT ?`;
  bindings.push(options.limit);

  const result = await env.DB.prepare(query).bind(...bindings).all<SessionRecord>();
  return result.results ?? [];
}

/** One session and a page of its messages, in conversation order. Null when it is not this user's. */
export async function getSessionMessages(
  env: Env,
  userId: string,
  sessionRef: string,
  options: { offset: number; limit: number },
): Promise<{ session: SessionRecord | null; messages: MessageRecord[] }> {
  const session = await env.DB.prepare(
    `SELECT s.*, d.device_name FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
     WHERE s.session_ref = ? AND s.user_id = ?`,
  )
    .bind(sessionRef, userId)
    .first<SessionRecord>();
  if (!session) return { session: null, messages: [] };

  const messages = await env.DB.prepare(
    `SELECT id, session_ref, tool, source_session_id, timestamp, role, content,
            message_index, content_hash, metadata_json, indexed_at
     FROM messages
     WHERE session_ref = ?
     ORDER BY timestamp ASC, message_index ASC, id ASC
     LIMIT ? OFFSET ?`,
  )
    .bind(sessionRef, options.limit, options.offset)
    .all<MessageRecord>();
  return { session, messages: messages.results ?? [] };
}

export interface UploadStatusRow {
  repo_url: string;
  project_name: string;
  device_id: string;
  device_name: string | null;
  last_upload_at: string;
  client_version: string | null;
  sessions: number;
}

/** When each of the user's devices last uploaded each project. */
export async function getUploadStatus(env: Env, userId: string, repoUrl?: string): Promise<UploadStatusRow[]> {
  const result = await env.DB.prepare(
    `SELECT u.repo_url, u.project_name, u.device_id, d.device_name, u.last_upload_at, u.client_version,
            (SELECT COUNT(*) FROM sessions s
             WHERE s.user_id = u.user_id AND s.repo_url = u.repo_url AND s.device_id = u.device_id) AS sessions
     FROM uploads u LEFT JOIN devices d ON d.id = u.device_id
     WHERE u.user_id = ? AND (? IS NULL OR u.repo_url = ?)
     ORDER BY u.last_upload_at DESC`,
  )
    .bind(userId, repoUrl ?? null, repoUrl ?? null)
    .all<UploadStatusRow>();
  return result.results ?? [];
}

/** Create or rename the account; returns its current token epoch. */
export async function upsertUser(env: Env, userId: string, username: string): Promise<number> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at`,
    ).bind(userId, username, now, now),
    env.DB.prepare(`INSERT OR IGNORE INTO token_epochs (user_id, epoch, updated_at) VALUES (?, 0, ?)`).bind(userId, now),
  ]);
  return (await getAccountState(env, userId)).epoch;
}

/** Whether the account exists, and the epoch its tokens must carry. */
export async function getAccountState(env: Env, userId: string): Promise<{ exists: boolean; epoch: number }> {
  const row = await env.DB.prepare(
    `SELECT (SELECT 1 FROM users WHERE id = ?) AS user_exists,
            (SELECT epoch FROM token_epochs WHERE user_id = ?) AS epoch`,
  )
    .bind(userId, userId)
    .first<{ user_exists: number | null; epoch: number | null }>();
  return { exists: row?.user_exists === 1, epoch: row?.epoch ?? 0 };
}

const bumpEpochStatement = (env: Env, userId: string) =>
  env.DB.prepare(
    `INSERT INTO token_epochs (user_id, epoch, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(user_id) DO UPDATE SET epoch = token_epochs.epoch + 1, updated_at = excluded.updated_at`,
  ).bind(userId, Date.now());

/** Invalidate every token issued to this user so far. */
export async function bumpTokenEpoch(env: Env, userId: string): Promise<void> {
  await bumpEpochStatement(env, userId).run();
}

/**
 * Remove everything held for a user, children first, then the account row,
 * and move the token epoch in the same batch. The epoch row itself is kept:
 * it is what stops a token from before the deletion working again after the
 * same GitHub account signs in later.
 */
export async function deleteUserData(env: Env, userId: string): Promise<void> {
  const owned = `(SELECT session_ref FROM sessions WHERE user_id = ?)`;
  await env.DB.batch([
    bumpEpochStatement(env, userId),
    env.DB.prepare(`DELETE FROM retrieval_units WHERE session_ref IN ${owned}`).bind(userId),
    env.DB.prepare(`DELETE FROM messages WHERE session_ref IN ${owned}`).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM uploads WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM devices WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}
