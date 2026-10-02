-- Sync v2: revocation that survives account deletion, authoritative
-- per-session uploads, and no absolute paths held in the cloud.

-- Revocation state. A token carries its user's epoch when it is minted and
-- is refused once the epoch has moved on: logout and delete-my-data both move
-- it. It lived on `users.token_version`, which delete-my-data removed along
-- with the row, so signing in again started the count over at 0 and every
-- token from before the deletion worked again. This table is never deleted
-- from.
CREATE TABLE IF NOT EXISTS token_epochs (
    user_id TEXT PRIMARY KEY,
    epoch INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO token_epochs (user_id, epoch, updated_at)
    SELECT id, token_version, updated_at FROM users;
ALTER TABLE users DROP COLUMN token_version;

-- Status was always the constant 'active'. source_path and source_pointer
-- held absolute paths from the uploading machine; nothing reads them.
ALTER TABLE sessions DROP COLUMN status;
ALTER TABLE sessions DROP COLUMN source_path;
ALTER TABLE messages DROP COLUMN source_pointer;

-- Session detail reads in this order.
DROP INDEX IF EXISTS idx_messages_session_order;
CREATE INDEX IF NOT EXISTS idx_messages_session_time
    ON messages(session_ref, timestamp, message_index, id);

-- One row per user, device and project: when it last uploaded. Lets a reader
-- tell a project that has synced and has nothing from one that never synced.
CREATE TABLE IF NOT EXISTS uploads (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    project_name TEXT NOT NULL,
    last_upload_at TEXT NOT NULL,
    client_version TEXT,
    PRIMARY KEY (user_id, device_id, repo_url)
);
