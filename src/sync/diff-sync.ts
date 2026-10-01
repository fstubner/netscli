import Database, { type Database as DatabaseHandle } from "better-sqlite3";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { assertSecureSyncUrl, loadCredentials } from "./client.js";
import { isOptedIn } from "./consent.js";
import { getCanonicalRepoId } from "./normalizer.js";
import { getSetting, setSetting } from "../handoff/schema.js";

const BATCH_SIZE = 100;

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

export interface DiffSyncResult {
  syncedCount: number;
  latestIndexedAt: string | null;
  upToDate: boolean;
}

/**
 * Upload what this project's index has gained since the last upload.
 *
 * Reads the project's own index, so only sessions already attributed to this
 * project can leave the machine. Refuses unless someone is logged in AND this
 * project is on the user's opt-in list; either alone uploads nothing.
 *
 * The high-water mark is kept per account: after logging in as someone else
 * the project has to be uploaded to them in full, not from where the previous
 * account left off.
 */
export async function runDiffSync(options: { projectDir: string }): Promise<DiffSyncResult> {
  const { projectDir } = options;
  const credentials = await loadCredentials();
  if (!credentials) throw new NotLoggedInError();
  if (!(await isOptedIn(projectDir))) throw new NotOptedInError();
  assertSecureSyncUrl(credentials.syncUrl);

  const dbPath = join(projectDir, ".xtctx", "state", "xtctx.db");
  if (!existsSync(dbPath)) {
    return { syncedCount: 0, latestIndexedAt: null, upToDate: true };
  }

  const db: DatabaseHandle = new Database(dbPath);
  try {
    const key = `cloud_last_synced_indexed_at:${credentials.user.id}`;
    const { repoId } = await getCanonicalRepoId(projectDir);
    const projectName = basename(projectDir);

    // Position is (indexed_at, id), not indexed_at alone: a scan stamps many
    // messages with the same time, and a batch boundary that fell inside such
    // a run would skip the rest of it for good.
    const saved = getSetting(db, key) ?? "1970-01-01T00:00:00.000Z|";
    const split = saved.indexOf("|");
    let cursorAt = saved.slice(0, split);
    let cursorId = saved.slice(split + 1);
    let totalSynced = 0;

    const query = db.prepare(`
      SELECT m.id, m.session_ref, m.tool, m.source_session_id, m.timestamp, m.role,
             m.content, m.message_index, m.content_hash, m.metadata_json, m.source_pointer, m.indexed_at,
             s.git_branch, s.git_commit, s.preview
      FROM messages m
      JOIN sessions s ON m.session_ref = s.session_ref
      WHERE (m.indexed_at, m.id) > (?, ?)
      ORDER BY m.indexed_at ASC, m.id ASC
      LIMIT ?
    `);

    while (true) {
      const rows = query.all(cursorAt, cursorId, BATCH_SIZE) as Array<Record<string, string | number | null>>;
      if (rows.length === 0) break;

      const deltas = rows.map((r) => ({
        deviceId: credentials.deviceId,
        deviceName: credentials.deviceName,
        tool: r.tool,
        sourceSessionId: r.source_session_id,
        repoUrl: repoId,
        // The folder name, not the path: the absolute one carries the user's
        // account name and directory layout and the server has no use for it.
        projectRoot: projectName,
        gitBranch: r.git_branch || undefined,
        gitCommit: r.git_commit || undefined,
        timestamp: r.timestamp,
        role: r.role,
        content: r.content,
        messageIndex: r.message_index,
        contentHash: r.content_hash,
        metadataJson: r.metadata_json,
        sourcePointer: r.source_pointer,
        preview: r.preview,
        status: "active",
      }));

      const res = await fetch(`${credentials.syncUrl.replace(/\/$/, "")}/api/stream`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(deltas),
      });
      if (!res.ok) {
        throw new Error(`Sync batch failed (${res.status}): ${await res.text()}`);
      }

      totalSynced += rows.length;
      cursorAt = String(rows[rows.length - 1].indexed_at);
      cursorId = String(rows[rows.length - 1].id);
      setSetting(db, key, `${cursorAt}|${cursorId}`);

      if (rows.length < BATCH_SIZE) break;
    }

    return { syncedCount: totalSynced, latestIndexedAt: totalSynced ? cursorAt : null, upToDate: totalSynced === 0 };
  } finally {
    db.close();
  }
}
