use sqlx::Row;

use super::Database;
use crate::error::{Error, Result};

/// Monotonically-increasing schema version. Bump this and add a matching
/// branch in `migrate_to` whenever the schema changes. The current
/// on-disk version is read from the `schema_version` table; we run every
/// migration between (current, CURRENT_VERSION] in order.
pub(super) const CURRENT_SCHEMA_VERSION: i64 = 1;

impl Database {
    /// Apply any pending schema migrations.
    ///
    /// The first run on a fresh DB starts at version 0, applies every
    /// migration up to `CURRENT_SCHEMA_VERSION`, and stamps the final
    /// version. Subsequent runs no-op until the constant is bumped.
    pub(super) async fn migrate(&self) -> Result<()> {
        // Ensure the version-tracking table exists before querying it.
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        let current: i64 = sqlx::query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version")
            .fetch_one(&self.pool)
            .await?
            .get("v");

        if current >= CURRENT_SCHEMA_VERSION {
            return Ok(());
        }

        // Apply each missing migration in order. Keep them idempotent
        // (`IF NOT EXISTS`) where possible so a partially-applied DB
        // re-converges on retry.
        for v in (current + 1)..=CURRENT_SCHEMA_VERSION {
            self.migrate_to(v).await?;
            sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
                .bind(v)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    async fn migrate_to(&self, version: i64) -> Result<()> {
        match version {
            1 => {
                // Initial schema: hosts + scan_history. Executed as a
                // single transaction so a crash mid-migration leaves the
                // DB at its previous version (including 0 = empty).
                let mut tx = self.pool.begin().await?;
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS hosts (
                        id INTEGER PRIMARY KEY,
                        mac_address TEXT UNIQUE NOT NULL,
                        ip_address TEXT,
                        hostname TEXT,
                        vendor TEXT,
                        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                        is_favorite BOOLEAN DEFAULT 0,
                        custom_label TEXT
                    );
                    "#,
                )
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS scan_history (
                        id INTEGER PRIMARY KEY,
                        command TEXT NOT NULL,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        duration_ms INTEGER,
                        result_json TEXT
                    );
                    "#,
                )
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                Ok(())
            }
            other => Err(Error::Other(format!(
                "unknown schema migration version: {other}"
            ))),
        }
    }

    /// Schema version currently applied to this database.
    pub async fn schema_version(&self) -> Result<i64> {
        let v: i64 = sqlx::query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version")
            .fetch_one(&self.pool)
            .await?
            .get("v");
        Ok(v)
    }
}
