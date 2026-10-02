import { mkdirSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { openDatabase } from "@xtctx/handoff/schema";

/**
 * A throwaway home and project, with every variable os.homedir() could read
 * pointed at the first. Nothing here may touch the real ~/.xtctx.
 */
export function sandbox() {
  // Resolved, as the index stores project roots: on macOS the temp dir is
  // behind /var -> /private/var, and a root seeded unresolved never matches.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xtctx-sync-")));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home);
  mkdirSync(project);
  for (const name of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) vi.stubEnv(name, home);
  for (const name of ["XTCTX_TOKEN", "XTCTX_SYNC_URL", "XTCTX_ALLOW_ENV_CREDENTIALS", "XTCTX_DEVICE_ID", "XTCTX_DEVICE_NAME"]) {
    vi.stubEnv(name, "");
  }
  return {
    root,
    home,
    project,
    cleanup() {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export const localId = (i: number) => i.toString(16).padStart(64, "0");

interface SeedOptions {
  indexedAt?: string;
  from?: number;
  sessionId?: string;
  projectRoot?: string;
  metadata?: Record<string, unknown>;
  sourcePointer?: string | null;
  content?: (i: number) => string;
}

/** Add `count` messages to one session of the project's real index, all stamped with the same time. */
export function seedIndex(project: string, count: number, indexedAtOrOptions: string | SeedOptions = {}, fromArg?: number) {
  const options: SeedOptions =
    typeof indexedAtOrOptions === "string" ? { indexedAt: indexedAtOrOptions, from: fromArg } : indexedAtOrOptions;
  const indexedAt = options.indexedAt ?? "2026-10-01T00:00:00.000Z";
  const from = options.from ?? 0;
  const sessionId = options.sessionId ?? "s1";
  const sessionRef = `claude-code:${sessionId}`;
  mkdirSync(join(project, ".xtctx", "state"), { recursive: true });
  const db = openDatabase(join(project, ".xtctx", "state", "xtctx.db"));
  try {
    db.prepare(
      `INSERT INTO sessions (session_ref, tool, source_session_id, project_root, started_at, last_activity_at, updated_at)
       VALUES (?, 'claude-code', ?, ?, ?, ?, ?)
       ON CONFLICT(session_ref) DO UPDATE SET updated_at = excluded.updated_at, last_activity_at = excluded.last_activity_at`,
    ).run(sessionRef, sessionId, options.projectRoot ?? project, indexedAt, indexedAt, indexedAt);
    const insert = db.prepare(
      `INSERT INTO messages (id, session_ref, tool, source_session_id, timestamp, role, content, message_index, content_hash, metadata_json, source_pointer, indexed_at)
       VALUES (?, ?, 'claude-code', ?, ?, 'user', ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = from; i < from + count; i++) {
      insert.run(
        localId(i + (sessionId === "s1" ? 0 : 1_000_000)),
        sessionRef,
        sessionId,
        indexedAt,
        options.content ? options.content(i) : `message ${i}`,
        i,
        `hash${i}`,
        JSON.stringify(options.metadata ?? {}),
        options.sourcePointer ?? null,
        indexedAt,
      );
    }
  } finally {
    db.close();
  }
}

/** Run SQL against the project's index, as a re-read by the scanner would. */
export function editIndex(project: string, fn: (db: ReturnType<typeof openDatabase>) => void) {
  const db = openDatabase(join(project, ".xtctx", "state", "xtctx.db"));
  try {
    fn(db);
  } finally {
    db.close();
  }
}

interface StoredMessage {
  id: string;
  content: string;
  metadataJson: string;
}

interface UploadSession {
  tool: string;
  sourceSessionId: string;
  messages: StoredMessage[];
  keepIds?: string[];
}

interface UploadBody {
  device: { id: string; name: string };
  project: { repoUrl: string; name: string };
  sessions: UploadSession[];
}

/**
 * The server's upload contract, in memory: messages upserted by id per
 * session, `keepIds` deleting the rest, and the session's count in reply.
 * Mirrors cloud/src/db.ts `ingestUpload`; the Worker's own tests cover that.
 */
export function fakeCloud() {
  const sessions = new Map<string, Map<string, StoredMessage>>();
  const requests: Array<{ url: string; method: string; headers: Headers; body: UploadBody }> = [];
  const state = {
    failStatus: undefined as number | undefined,
    tooLarge: new Set<string>(),
  };

  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const body = (init.body ? JSON.parse(String(init.body)) : undefined) as UploadBody;
    requests.push({ url: String(url), method: init.method ?? "GET", headers, body });
    if (state.failStatus) return Response.json({ error: "boom" }, { status: state.failStatus });

    for (const s of body?.sessions ?? []) {
      for (const m of s.messages) {
        if (state.tooLarge.has(m.id)) {
          return Response.json(
            { error: "message_too_large", limit: 65536, tool: s.tool, sourceSessionId: s.sourceSessionId, messageId: m.id },
            { status: 413 },
          );
        }
      }
    }
    const counts = [];
    for (const s of body?.sessions ?? []) {
      const key = `${s.tool}:${s.sourceSessionId}`;
      const stored = sessions.get(key) ?? new Map<string, StoredMessage>();
      sessions.set(key, stored);
      for (const m of s.messages) stored.set(m.id, m);
      if (s.keepIds) for (const id of [...stored.keys()]) if (!s.keepIds.includes(id)) stored.delete(id);
      counts.push({ tool: s.tool, sourceSessionId: s.sourceSessionId, messageCount: stored.size });
    }
    return Response.json({ success: true, sessions: counts });
  });

  return {
    fetch: fetchImpl,
    sessions,
    requests,
    state,
    uploads: () => requests.filter((r) => r.url.endsWith("/api/stream")),
    sentMessages: () => requests.flatMap((r) => (r.body?.sessions ?? []).flatMap((s) => s.messages)),
    stored: (sessionId = "s1") => [...(sessions.get(`claude-code:${sessionId}`)?.values() ?? [])],
  };
}

export function loginFile(home: string): string {
  return join(home, ".xtctx", "credentials.json");
}
