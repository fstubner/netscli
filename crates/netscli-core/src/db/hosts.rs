use super::{Database, HostRecord};
use crate::error::Result;

impl Database {
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
}
