import Database, { type Database as DatabaseHandle } from "better-sqlite3";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadCredentials, type SyncCredentials } from "./client.js";
import { getCanonicalRepoId } from "./normalizer.js";
import { getSetting, setSetting } from "../handoff/schema.js";

const BATCH_SIZE = 100;
const CLOUD_SYNC_KEY = "cloud_last_synced_indexed_at";

export interface DiffSyncResult {
  syncedCount: number;
  latestIndexedAt: string | null;
  upToDate: boolean;
}

/**
 * Execute an automatic incremental diff sync.
 * Queries turns added/indexed since the last high-water mark across all scrapers
 * and streams them in batches to sync.xtctx.com.
 */
export async function runDiffSync(options: { projectDir?: string }): Promise<DiffSyncResult> {
  const projectDir = options.projectDir || process.cwd();
  const credentials = await loadCredentials();

  if (!credentials) {
    throw new Error("Not authenticated. Please run `xtctx login` first.");
  }

  const dbPath = join(projectDir, ".xtctx", "state", "xtctx.db");
  if (!existsSync(dbPath)) {
    return { syncedCount: 0, latestIndexedAt: null, upToDate: true };
  }

  const db: DatabaseHandle = new Database(dbPath);
  try {
    const lastSynced = getSetting(db, CLOUD_SYNC_KEY) || "1970-01-01T00:00:00.000Z";
    const { repoId, repoRoot } = await getCanonicalRepoId(projectDir);

    let totalSynced = 0;
    let currentHighWater = lastSynced;

    const queryStmt = db.prepare(`
      SELECT m.id, m.session_ref, m.tool, m.source_session_id, m.timestamp, m.role,
             m.content, m.message_index, m.content_hash, m.metadata_json, m.source_pointer, m.indexed_at,
             s.git_branch, s.git_commit, s.preview, s.status
      FROM messages m
      JOIN sessions s ON m.session_ref = s.session_ref
      WHERE m.indexed_at > ?
      ORDER BY m.indexed_at ASC
      LIMIT ?
    `);

    while (true) {
      const rows = queryStmt.all(currentHighWater, BATCH_SIZE) as any[];
      if (rows.length === 0) break;

      const deltas = rows.map((r) => ({
        deviceId: credentials.deviceId,
        deviceName: credentials.deviceName,
        tool: r.tool,
        sourceSessionId: r.source_session_id,
        repoUrl: repoId,
        projectRoot: repoRoot,
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
        status: r.status || "active",
      }));

      // Push batch delta to Cloudflare
      const url = `${credentials.syncUrl.replace(/\/$/, "")}/api/stream`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(deltas),
      });

      if (!res.ok) {
        throw new Error(`Sync batch failed (${res.status}): ${await res.text()}`);
      }

      totalSynced += rows.length;
      currentHighWater = rows[rows.length - 1].indexed_at;
      setSetting(db, CLOUD_SYNC_KEY, currentHighWater);

      if (rows.length < BATCH_SIZE) break;
    }

    return {
      syncedCount: totalSynced,
      latestIndexedAt: currentHighWater,
      upToDate: totalSynced === 0,
    };
  } finally {
    db.close();
  }
}
