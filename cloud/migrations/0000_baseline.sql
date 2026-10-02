-- Baseline: the schema as it stood when migrations started being tracked by
-- `wrangler d1 migrations apply` (schema.sql plus the old 0001_token_version).
--
-- Every statement is IF NOT EXISTS, so applying this to a database created
-- before then changes nothing; see cloud/README.md ("A database created
-- before tracked migrations") for the one check to make first.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,               -- e.g. "github:123456"
    username TEXT NOT NULL,           -- e.g. "fstubner"
    display_name TEXT,
    email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0 -- superseded by token_epochs in 0001
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,               -- e.g. UUID or machine slug
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,         -- e.g. "felix-desktop", "macbook-air"
    hostname TEXT,
    last_seen_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS sessions (
    session_ref TEXT PRIMARY KEY,      -- e.g. "usr_123:claude-code:abc123"
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id),
    tool TEXT NOT NULL,                -- "claude-code", "antigravity", "cursor", "copilot", "codex"
    source_session_id TEXT NOT NULL,
    repo_url TEXT NOT NULL,            -- e.g. "github.com/fstubner/xtctx"
    project_root TEXT NOT NULL,        -- local root path on the origin device
    git_branch TEXT,
    git_commit TEXT,
    started_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    preview TEXT,
    source_path TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'idle', 'closed'
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_repo 
    ON sessions(user_id, repo_url, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_activity 
    ON sessions(user_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_ref TEXT NOT NULL REFERENCES sessions(session_ref) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    role TEXT NOT NULL,                -- "user", "assistant", "system", "tool"
    content TEXT NOT NULL,
    message_index INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    metadata_json TEXT NOT NULL,       -- JSON string with tool_calls, tokens, etc.
    source_pointer TEXT,
    indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_order 
    ON messages(session_ref, message_index ASC);

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
