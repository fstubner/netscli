import Database, { type Database as DatabaseHandle } from "better-sqlite3";
import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { assertSecureSyncUrl, callCloud, loadCredentials, resolveUploadCredentials, type SyncCredentials } from "./client.js";
import { isOptedIn } from "./consent.js";
import { getCanonicalRepoId } from "./normalizer.js";
import {
  accountKey,
  acquireUploadLock,
  readAccountState,
  updateAccountState,
  type SkippedMessage,
  type UploadLock,
} from "./state.js";
import { UPLOAD_LIMITS, fitContent, sanitizeMetadata } from "./upload-format.js";
import { PROJECT_ROOT_SQL, normalizeRootForCompare } from "../handoff/queries.js";

export class NotLoggedInError extends Error {
  constructor() {
    super("Not logged in to xtctx cloud. Run `xtctx login` first.");
  }
}

export class NotOptedInError extends Error {
  constructor() {
    super("This project is not opted in to cloud sync. Run `xtctx sync enable` in it first.");
  }
}

/** The server no longer accepts this login: expired, signed out, or deleted. */
export class CloudAuthError extends Error {
  constructor(status: number) {
    super(
      status === 403
        ? "xtctx cloud refused this login (403): the account is not allowed on this server, or the token lacks the sync:write scope. Run `xtctx login` again."
        : "Your xtctx cloud login is no longer valid (expired or signed out). Run `xtctx login`.",
    );
  }
}

export interface DiffSyncResult {
  /** Messages sent this run. */
  syncedCount: number;
  /** Sessions sent this run. */
  sessionCount: number;
  /** Messages the server refused as too large this run; they are skipped from now on. */
  skipped: SkippedMessage[];
  upToDate: boolean;
  /** Another process was uploading this project; nothing was done. */
  busy: boolean;
}

/**
 * Changes from the last minute are sent again on the next run. A write to the
 * index can be stamped before this run's read and committed after it; going
 * back a minute picks those up, and re-sending is harmless because uploads are
 * idempotent.
 */
const CURSOR_LAG_MS = 60_000;
/** With nothing to send, still tell the server the project is in sync this often. */
const REPORT_EVERY_MS = 15 * 60_000;
/** Above this many message ids the per-session reconcile does not fit in one request. */
const MAX_KEEP_IDS = Math.floor((UPLOAD_LIMITS.targetBodyBytes - 4096) / 70);

interface SessionRow {
  session_ref: string;
  tool: string;
  source_session_id: string;
  git_branch: string | null;
  git_commit: string | null;
  started_at: string;
  last_activity_at: string;
  preview: string | null;
}

interface MessageRow {
  id: string;
  timestamp: string;
  role: string;
  content: string;
  message_index: number;
  content_hash: string;
  metadata_json: string;
}

interface UploadMessage {
  id: string;
  timestamp: string;
  role: string;
  content: string;
  messageIndex: number;
  contentHash: string;
  metadataJson: string;
}

/** One session's slice of an upload. A session too big for one request goes as several. */
interface Part {
  session: SessionRow;
  messages: UploadMessage[];
  /** On a session's final part when reconciling: everything else the cloud holds for it is deleted. */
  keepIds?: string[];
}

function canonicalRoot(projectDir: string): string {
  try {
    return realpathSync(projectDir);
  } catch {
    return projectDir;
  }
}

const skipKey = (sessionRef: string, messageId: string) => `${sessionRef}\u0000${messageId}`;
const sessionKey = (tool: string, sourceSessionId: string) => `${tool}:${sourceSessionId}`;

function toUpload(row: MessageRow): UploadMessage {
  return {
    id: row.id,
    timestamp: row.timestamp,
    role: row.role,
    content: fitContent(row.content),
    messageIndex: row.message_index,
    contentHash: row.content_hash,
    metadataJson: sanitizeMetadata(row.metadata_json),
  };
}

const messageBytes = (m: UploadMessage) => Buffer.byteLength(JSON.stringify(m)) + 1;
const SESSION_OVERHEAD = 1024;

/** Split one session's messages into parts that each fit a request. */
function partsFor(session: SessionRow, messages: UploadMessage[], keepIds?: string[]): Part[] {
  const parts: Part[] = [];
  let current: UploadMessage[] = [];
  let bytes = SESSION_OVERHEAD;
  for (const m of messages) {
    const size = messageBytes(m);
    if (current.length > 0 && (bytes + size > UPLOAD_LIMITS.targetBodyBytes || current.length >= UPLOAD_LIMITS.maxMessagesPerRequest)) {
      parts.push({ session, messages: current });
      current = [];
      bytes = SESSION_OVERHEAD;
    }
    current.push(m);
    bytes += size;
  }
  if (current.length > 0 || parts.length === 0) parts.push({ session, messages: current });
  if (keepIds) parts.push({ session, messages: [], keepIds });
  return parts;
}

const partBytes = (p: Part) =>
  SESSION_OVERHEAD + p.messages.reduce((n, m) => n + messageBytes(m), 0) + (p.keepIds?.length ?? 0) * 70;

/** Group parts into requests, in order, each under every per-request limit. */
function packRequests(parts: Part[]): Part[][] {
  const requests: Part[][] = [];
  let current: Part[] = [];
  let bytes = 0;
  let messages = 0;
  for (const p of parts) {
    const size = partBytes(p);
    if (
      current.length > 0 &&
      (bytes + size > UPLOAD_LIMITS.targetBodyBytes ||
        current.length >= UPLOAD_LIMITS.maxSessionsPerRequest ||
        messages + p.messages.length > UPLOAD_LIMITS.maxMessagesPerRequest)
    ) {
      requests.push(current);
      current = [];
      bytes = 0;
      messages = 0;
    }
    current.push(p);
    bytes += size;
    messages += p.messages.length;
  }
  if (current.length > 0) requests.push(current);
  return requests;
}

/**
 * Upload what this project's index has gained or changed since the last
 * upload, for the logged-in account.
 *
 * Only sessions the index attributes to THIS project are read, compared the
 * same way the index's own reads compare roots: an index can hold rows for
 * another root (a copied `.xtctx/`, a renamed folder), and those stay here.
 *
 * Each session's upload is authoritative. New and changed messages are sent
 * keyed by their local id, and the server answers with how many it now holds
 * for the session. When that differs from the local count (a re-read here
 * deleted or replaced messages, or an earlier version uploaded under other
 * ids), the whole session is sent again with the full list of its ids, and
 * the server deletes everything else. Every request is idempotent.
 *
 * Refuses unless someone is logged in AND this project is on the user's
 * opt-in list. Only one process uploads a project at a time; another one
 * finds it busy and does nothing. The position only moves after a run that
 * sent everything, so a failure resends rather than skips.
 */
export async function runDiffSync(options: { projectDir: string }): Promise<DiffSyncResult> {
  const { projectDir } = options;
  if (!(await loadCredentials())) throw new NotLoggedInError();
  if (!(await isOptedIn(projectDir))) throw new NotOptedInError();
  const credentials = await resolveUploadCredentials();
  if (!credentials) throw new NotLoggedInError();
  assertSecureSyncUrl(credentials.syncUrl);

  const account = accountKey(credentials.user.id, credentials.syncUrl);
  const lock = await acquireUploadLock(projectDir);
  if (!lock) return { syncedCount: 0, sessionCount: 0, skipped: [], upToDate: false, busy: true };

  const attemptAt = new Date().toISOString();
  try {
    const outcome = await upload(projectDir, credentials, account, lock);
    await updateAccountState(projectDir, account, (s) => ({
      ...s,
      cursor: outcome.cursor,
      lastAttemptAt: attemptAt,
      lastSuccessAt: new Date().toISOString(),
      lastError: undefined,
      lastErrorAt: undefined,
      lastReportedAt: outcome.reported ? new Date().toISOString() : s.lastReportedAt,
    }));
    return outcome.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAccountState(projectDir, account, (s) => ({
      ...s,
      lastAttemptAt: attemptAt,
      lastError: message,
      lastErrorAt: new Date().toISOString(),
    })).catch(() => undefined);
    throw err;
  } finally {
    await lock.release();
  }
}

async function upload(
  projectDir: string,
  credentials: SyncCredentials,
  account: string,
  lock: UploadLock,
): Promise<{ result: DiffSyncResult; cursor: string; reported: boolean }> {
  const result: DiffSyncResult = { syncedCount: 0, sessionCount: 0, skipped: [], upToDate: true, busy: false };
  const state = await readAccountState(projectDir, account);
  const cursor = state.cursor ?? "";
  const nextCursor = new Date(Date.now() - CURSOR_LAG_MS).toISOString();

  const dbPath = join(projectDir, ".xtctx", "state", "xtctx.db");
  if (!existsSync(dbPath)) return { result, cursor: nextCursor, reported: false };

  const skipped = new Set(state.skipped.map((s) => skipKey(s.sessionRef, s.messageId)));
  const { repoId } = await getCanonicalRepoId(projectDir);
  const envelope = {
    device: { id: credentials.deviceId, name: credentials.deviceName },
    project: { repoUrl: repoId, name: basename(projectDir) },
  };

  const db: DatabaseHandle = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const scopedRoot = normalizeRootForCompare(canonicalRoot(projectDir));
    const changed = db
      .prepare(
        `SELECT s.session_ref, s.tool, s.source_session_id, s.git_branch, s.git_commit,
                s.started_at, s.last_activity_at, s.preview
         FROM sessions s
         WHERE ${PROJECT_ROOT_SQL.replace("project_root", "s.project_root")} = ?
           AND (s.updated_at > ?
                OR EXISTS (SELECT 1 FROM messages m WHERE m.session_ref = s.session_ref AND m.indexed_at > ?))
         ORDER BY s.last_activity_at ASC, s.session_ref ASC`,
      )
      .all(scopedRoot, cursor, cursor) as SessionRow[];

    const messagesSince = db.prepare(
      `SELECT id, timestamp, role, content, message_index, content_hash, metadata_json
       FROM messages WHERE session_ref = ? AND indexed_at > ?
       ORDER BY timestamp ASC, message_index ASC, id ASC`,
    );
    const localIds = (sessionRef: string) =>
      (db.prepare(`SELECT id FROM messages WHERE session_ref = ?`).all(sessionRef) as Array<{ id: string }>)
        .map((r) => r.id)
        .filter((id) => !skipped.has(skipKey(sessionRef, id)));
    const unskipped = (sessionRef: string, rows: MessageRow[]) =>
      rows.filter((r) => !skipped.has(skipKey(sessionRef, r.id))).map(toUpload);

    let reported = false;
    const send = async (parts: Part[]): Promise<Map<string, number>> => {
      const counts = new Map<string, number>();
      for (const request of packRequests(parts)) {
        await sendRequest(request, counts);
        reported = true;
        await lock.touch();
      }
      return counts;
    };

    /**
     * Send one request, skipping exactly the message the server refuses as
     * too large and splitting a request it refuses as too big overall, so one
     * oversized message never blocks the rest of the project.
     */
    const sendRequest = async (parts: Part[], counts: Map<string, number>): Promise<void> => {
      for (;;) {
        const res = await callCloud(credentials, "POST", "/api/stream", {
          ...envelope,
          sessions: parts.map((p) => ({
            tool: p.session.tool,
            sourceSessionId: p.session.source_session_id,
            gitBranch: p.session.git_branch,
            gitCommit: p.session.git_commit,
            startedAt: p.session.started_at,
            lastActivityAt: p.session.last_activity_at,
            // What the server keeps; no more is sent than it stores.
            preview: p.session.preview?.slice(0, 160) ?? null,
            messages: p.messages,
            ...(p.keepIds ? { keepIds: p.keepIds } : {}),
          })),
        });

        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            sessions?: Array<{ tool: string; sourceSessionId: string; messageCount: number }>;
          };
          for (const s of body.sessions ?? []) counts.set(sessionKey(s.tool, s.sourceSessionId), s.messageCount);
          for (const p of parts) result.syncedCount += p.messages.length;
          return;
        }

        const detail = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.status === 401 || res.status === 403) throw new CloudAuthError(res.status);
        if (res.status === 426) {
          throw new Error(`xtctx cloud needs a newer client: ${String(detail.detail ?? "update xtctx")}`);
        }
        if (res.status === 413 && detail.error === "message_too_large" && typeof detail.messageId === "string") {
          const part = parts.find(
            (p) =>
              p.session.tool === detail.tool &&
              p.session.source_session_id === detail.sourceSessionId &&
              p.messages.some((m) => m.id === detail.messageId),
          );
          if (part) {
            await skip(part, detail.messageId, `larger than the server accepts (${String(detail.limit)} bytes)`);
            continue;
          }
        }
        if (res.status === 413) {
          if (parts.length > 1) {
            const half = Math.ceil(parts.length / 2);
            await sendRequest(parts.slice(0, half), counts);
            await sendRequest(parts.slice(half), counts);
            return;
          }
          const [only] = parts;
          if (only.messages.length > 1) {
            const half = Math.ceil(only.messages.length / 2);
            await sendRequest([{ ...only, messages: only.messages.slice(0, half), keepIds: undefined }], counts);
            await sendRequest([{ ...only, messages: only.messages.slice(half) }], counts);
            return;
          }
          if (only.messages.length === 1) {
            await skip(only, only.messages[0].id, "the request carrying it alone was larger than the server accepts");
            continue;
          }
        }
        throw new Error(`Upload failed (${res.status}): ${String(detail.error ?? res.statusText)}`);
      }
    };

    const skip = async (part: Part, messageId: string, reason: string) => {
      const entry: SkippedMessage = {
        sessionRef: part.session.session_ref,
        messageId,
        reason,
        at: new Date().toISOString(),
      };
      part.messages = part.messages.filter((m) => m.id !== messageId);
      if (part.keepIds) part.keepIds = part.keepIds.filter((id) => id !== messageId);
      skipped.add(skipKey(entry.sessionRef, messageId));
      result.skipped.push(entry);
      await updateAccountState(projectDir, account, (s) => ({ ...s, skipped: [...s.skipped, entry] }));
    };

    // Pass 1: what changed, per session.
    const firstPass: Part[] = [];
    for (const session of changed) {
      const rows = messagesSince.all(session.session_ref, cursor) as MessageRow[];
      firstPass.push(...partsFor(session, unskipped(session.session_ref, rows)));
    }
    const counts = await send(firstPass);

    // Pass 2: sessions whose cloud copy does not match, sent whole with their ids.
    const reconcile: Part[] = [];
    for (const session of changed) {
      const ids = localIds(session.session_ref);
      if (counts.get(sessionKey(session.tool, session.source_session_id)) === ids.length) continue;
      const rows = db
        .prepare(
          `SELECT id, timestamp, role, content, message_index, content_hash, metadata_json
           FROM messages WHERE session_ref = ? ORDER BY timestamp ASC, message_index ASC, id ASC`,
        )
        .all(session.session_ref) as MessageRow[];
      // A session too large to name in one request is sent but not pruned.
      reconcile.push(...partsFor(session, unskipped(session.session_ref, rows), ids.length <= MAX_KEEP_IDS ? ids : undefined));
    }
    if (reconcile.length > 0) await send(reconcile);

    // Nothing to send: still let the server know this project is in sync,
    // now and then, so a reader can tell "synced, nothing new" from "never".
    const stale = !state.lastReportedAt || Date.now() - Date.parse(state.lastReportedAt) > REPORT_EVERY_MS;
    if (changed.length === 0 && stale) {
      await sendRequest([], new Map());
      reported = true;
    }

    result.sessionCount = changed.length;
    result.upToDate = result.syncedCount === 0 && result.skipped.length === 0;
    return { result, cursor: nextCursor, reported };
  } finally {
    db.close();
  }
}
