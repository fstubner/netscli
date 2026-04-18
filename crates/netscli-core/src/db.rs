use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePool},
    FromRow, Row,
};
use std::path::PathBuf;

use crate::error::{Error, Result};

#[derive(Debug, FromRow, Serialize)]
pub struct HostRecord {
    pub id: i64,
    pub mac_address: String,
    pub ip_address: Option<String>,
    pub hostname: Option<String>,
    pub vendor: Option<String>,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub is_favorite: bool,
    pub custom_label: Option<String>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct ScanHistoryRecord {
    pub id: i64,
    pub command: String,
    pub timestamp: DateTime<Utc>,
    pub duration_ms: i64,
    pub result_json: String,
}

/// Monotonically-increasing schema version. Bump this and add a matching
/// branch in `migrate_to` whenever the schema changes. The current
/// on-disk version is read from the `schema_version` table; we run every
/// migration between (current, CURRENT_VERSION] in order.
const CURRENT_SCHEMA_VERSION: i64 = 1;

pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn new(db_path: PathBuf) -> Result<Self> {
        let opts = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(opts).await?;

        let db = Self { pool };
        db.migrate().await?;
        Ok(db)
    }

    /// Apply any pending schema migrations.
    ///
    /// The first run on a fresh DB starts at version 0, applies every
    /// migration up to `CURRENT_SCHEMA_VERSION`, and stamps the final
    /// version. Subsequent runs no-op until the constant is bumped.
    async fn migrate(&self) -> Result<()> {
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

    pub async fn upsert_host(
        &self,
        mac: &str,
        ip: Option<&str>,
        hostname: Option<&str>,
        vendor: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO hosts (mac_address, ip_address, hostname, vendor, last_seen)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(mac_address) DO UPDATE SET
                ip_address = COALESCE(excluded.ip_address, hosts.ip_address),
                hostname = COALESCE(excluded.hostname, hosts.hostname),
                vendor = COALESCE(excluded.vendor, hosts.vendor),
                last_seen = CURRENT_TIMESTAMP
            "#,
        )
        .bind(mac)
        .bind(ip)
        .bind(hostname)
        .bind(vendor)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn add_scan_history(
        &self,
        command: &str,
        duration_ms: i64,
        result_json: &str,
    ) -> Result<i64> {
        let id = sqlx::query(
            r#"
            INSERT INTO scan_history (command, timestamp, duration_ms, result_json)
            VALUES (?, CURRENT_TIMESTAMP, ?, ?)
            "#,
        )
        .bind(command)
        .bind(duration_ms)
        .bind(result_json)
        .execute(&self.pool)
        .await?
        .last_insert_rowid();
        Ok(id)
    }

    pub async fn get_hosts(&self) -> Result<Vec<HostRecord>> {
        let hosts = sqlx::query_as::<_, HostRecord>("SELECT * FROM hosts ORDER BY last_seen DESC")
            .fetch_all(&self.pool)
            .await?;
        Ok(hosts)
    }

    /// Mark a host as a favorite (or un-favorite it). Host is identified
    /// by its MAC address.
    pub async fn set_favorite(&self, mac: &str, favorite: bool) -> Result<()> {
        sqlx::query("UPDATE hosts SET is_favorite = ? WHERE mac_address = ?")
            .bind(favorite)
            .bind(mac)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Set a user-supplied label for a host (e.g. "living room printer").
    /// Pass `None` to clear the label.
    pub async fn set_custom_label(&self, mac: &str, label: Option<&str>) -> Result<()> {
        sqlx::query("UPDATE hosts SET custom_label = ? WHERE mac_address = ?")
            .bind(label)
            .bind(mac)
            .execute(&self.pool)
            .await?;
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(db_path).await.unwrap();
        (db, temp_dir)
    }

    #[tokio::test]
    async fn test_database_creation_applies_migrations() {
        let (db, _temp) = create_test_db().await;
        assert_eq!(db.schema_version().await.unwrap(), CURRENT_SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn test_reopening_db_is_no_op() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("reopen.db");

        // First open creates schema.
        {
            let db = Database::new(db_path.clone()).await.unwrap();
            db.upsert_host("aa:bb:cc:dd:ee:ff", Some("10.0.0.1"), None, None)
                .await
                .unwrap();
        }

        // Second open should not re-run migrations and must preserve data.
        let db = Database::new(db_path).await.unwrap();
        assert_eq!(db.schema_version().await.unwrap(), CURRENT_SCHEMA_VERSION);
        let hosts = db.get_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
    }

    #[tokio::test]
    async fn test_upsert_host() {
        let (db, _temp) = create_test_db().await;

        db.upsert_host(
            "00:11:22:33:44:55",
            Some("192.168.1.1"),
            Some("test-host"),
            Some("TestVendor"),
        )
        .await
        .unwrap();

        let hosts = db.get_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].mac_address, "00:11:22:33:44:55");
        assert_eq!(hosts[0].ip_address, Some("192.168.1.1".to_string()));
        assert_eq!(hosts[0].hostname, Some("test-host".to_string()));
        assert_eq!(hosts[0].vendor, Some("TestVendor".to_string()));
    }

    #[tokio::test]
    async fn test_upsert_host_update() {
        let (db, _temp) = create_test_db().await;

        db.upsert_host(
            "00:11:22:33:44:55",
            Some("192.168.1.1"),
            Some("old-host"),
            None,
        )
        .await
        .unwrap();

        db.upsert_host(
            "00:11:22:33:44:55",
            Some("192.168.1.2"),
            Some("new-host"),
            Some("Vendor"),
        )
        .await
        .unwrap();

        let hosts = db.get_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].ip_address, Some("192.168.1.2".to_string()));
        assert_eq!(hosts[0].hostname, Some("new-host".to_string()));
    }

    #[tokio::test]
    async fn test_upsert_host_does_not_clear_ip_on_none() {
        let (db, _temp) = create_test_db().await;

        db.upsert_host(
            "00:11:22:33:44:55",
            Some("192.168.1.1"),
            Some("first-host"),
            None,
        )
        .await
        .unwrap();

        db.upsert_host("00:11:22:33:44:55", None, Some("second-host"), None)
            .await
            .unwrap();

        let hosts = db.get_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].ip_address, Some("192.168.1.1".to_string()));
        assert_eq!(hosts[0].hostname, Some("second-host".to_string()));
    }

    #[tokio::test]
    async fn test_add_scan_history() {
        let (db, _temp) = create_test_db().await;

        let id = db
            .add_scan_history("discover", 1234, r#"{"hosts":[]}"#)
            .await
            .unwrap();

        assert!(id > 0);
    }

    #[tokio::test]
    async fn test_set_favorite_and_label() {
        let (db, _temp) = create_test_db().await;

        db.upsert_host("00:11:22:33:44:55", Some("10.0.0.1"), None, None)
            .await
            .unwrap();

        db.set_favorite("00:11:22:33:44:55", true).await.unwrap();
        db.set_custom_label("00:11:22:33:44:55", Some("Printer"))
            .await
            .unwrap();

        let hosts = db.get_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
        assert!(hosts[0].is_favorite);
        assert_eq!(hosts[0].custom_label.as_deref(), Some("Printer"));

        // Round-trip: clear both.
        db.set_favorite("00:11:22:33:44:55", false).await.unwrap();
        db.set_custom_label("00:11:22:33:44:55", None)
            .await
            .unwrap();
        let hosts = db.get_hosts().await.unwrap();
        assert!(!hosts[0].is_favorite);
        assert_eq!(hosts[0].custom_label, None);
    }
}
