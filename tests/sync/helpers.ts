import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { openDatabase } from "@xtctx/handoff/schema";

/**
 * A throwaway home and project, with every variable os.homedir() could read
 * pointed at the first. Nothing here may touch the real ~/.xtctx.
 */
export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "xtctx-sync-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home);
  mkdirSync(project);
  for (const name of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) vi.stubEnv(name, home);
  vi.stubEnv("XTCTX_TOKEN", "");
  return {
    home,
    project,
    cleanup() {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Add `count` messages to the project's real index, all stamped with the same time. */
export function seedIndex(project: string, count: number, indexedAt = "2026-10-01T00:00:00.000Z", from = 0) {
  mkdirSync(join(project, ".xtctx", "state"), { recursive: true });
  const db = openDatabase(join(project, ".xtctx", "state", "xtctx.db"));
  try {
    db.prepare(
      `INSERT OR IGNORE INTO sessions (session_ref, tool, source_session_id, project_root, started_at, last_activity_at, updated_at)
       VALUES ('claude-code:s1', 'claude-code', 's1', ?, ?, ?, ?)`,
    ).run(project, indexedAt, indexedAt, indexedAt);
    const insert = db.prepare(
      `INSERT INTO messages (id, session_ref, tool, source_session_id, timestamp, role, content, message_index, content_hash, metadata_json, indexed_at)
       VALUES (?, 'claude-code:s1', 'claude-code', 's1', ?, 'user', ?, ?, ?, '{}', ?)`,
    );
    for (let i = from; i < from + count; i++) {
      insert.run(`m${String(i).padStart(5, "0")}`, indexedAt, `message ${i}`, i, `hash${i}`, indexedAt);
    }
  } finally {
    db.close();
  }
}

export function loginFile(home: string): string {
  return join(home, ".xtctx", "credentials.json");
}
