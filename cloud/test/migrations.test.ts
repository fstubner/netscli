import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./fake-env.js";

const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe("migrations", () => {
  it("bring a database created before tracked migrations forward without losing data or signing anyone out", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    // What production has: the old schema.sql (now the baseline), in use.
    applyMigrations(db, 1);
    db.exec(`
      INSERT INTO users (id, username, created_at, updated_at, token_version) VALUES ('github:1', 'alice', 1, 1, 3);
      INSERT INTO devices (id, user_id, device_name, last_seen_at, created_at) VALUES ('github:1:d', 'github:1', 'host', 1, 1);
      INSERT INTO sessions (session_ref, user_id, device_id, tool, source_session_id, repo_url, project_root,
        started_at, last_activity_at, message_count, source_path, status, updated_at)
        VALUES ('github:1:claude-code:s', 'github:1', 'github:1:d', 'claude-code', 's', 'r', 'p', 't', 't', 1, '/home/alice/x.jsonl', 'active', 't');
      INSERT INTO messages (id, session_ref, tool, source_session_id, timestamp, role, content, message_index,
        content_hash, metadata_json, source_pointer, indexed_at)
        VALUES ('m', 'github:1:claude-code:s', 'claude-code', 's', 't', 'user', 'hello', 0, 'h', '{}', '/home/alice/x.jsonl', 't');
    `);

    // The rest, in order, the way `wrangler d1 migrations apply` runs them;
    // the baseline again too, which must be a no-op on a database that has it.
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    db.exec(readFileSync(dir + files[0], "utf8"));
    for (const file of files.slice(1)) db.exec(readFileSync(dir + file, "utf8"));

    expect(db.prepare("SELECT epoch FROM token_epochs WHERE user_id = 'github:1'").get()).toEqual({ epoch: 3 });
    expect(db.prepare("SELECT content FROM messages").get()).toEqual({ content: "hello" });
    expect(db.prepare("SELECT message_count FROM sessions").get()).toEqual({ message_count: 1 });
    expect(columns(db, "users")).not.toContain("token_version");
    expect(columns(db, "sessions")).not.toContain("source_path");
    expect(columns(db, "sessions")).not.toContain("status");
    expect(columns(db, "messages")).not.toContain("source_pointer");
  });

  it("create the full schema on an empty database", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrations(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["users", "devices", "sessions", "messages", "token_epochs", "uploads"]));
  });
});
