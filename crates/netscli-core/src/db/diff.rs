use super::{Database, ScanHistoryRecord};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkDiff {
    pub scan1_id: i64,
    pub scan2_id: i64,
    pub scan1_timestamp: chrono::DateTime<chrono::Utc>,
    pub scan2_timestamp: chrono::DateTime<chrono::Utc>,
    pub joined_hosts: Vec<String>,
    pub departed_hosts: Vec<String>,
    pub unchanged_hosts: Vec<String>,
}

impl Database {
    pub async fn get_scan_history_by_id(&self, id: i64) -> Result<ScanHistoryRecord> {
        let rec = sqlx::query_as::<_, ScanHistoryRecord>("SELECT * FROM scan_history WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok(rec)
    }

    pub async fn get_recent_scans(&self, limit: i64) -> Result<Vec<ScanHistoryRecord>> {
        let recs = sqlx::query_as::<_, ScanHistoryRecord>(
            "SELECT * FROM scan_history ORDER BY id DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(recs)
    }

    pub async fn diff_latest_two_scans(&self) -> Result<Option<NetworkDiff>> {
        let recent = self.get_recent_scans(2).await?;
        if recent.len() < 2 {
            return Ok(None);
        }
        // recent[0] is newest (scan2), recent[1] is older (scan1)
        let diff = self.diff_scans(recent[1].id, recent[0].id).await?;
        Ok(Some(diff))
    }

    pub async fn diff_scans(&self, scan1_id: i64, scan2_id: i64) -> Result<NetworkDiff> {
        let s1 = self.get_scan_history_by_id(scan1_id).await?;
        let s2 = self.get_scan_history_by_id(scan2_id).await?;

        let hosts1 = extract_hosts(&s1.result_json);
        let hosts2 = extract_hosts(&s2.result_json);

        let mut joined: Vec<String> = hosts2.difference(&hosts1).cloned().collect();
        let mut departed: Vec<String> = hosts1.difference(&hosts2).cloned().collect();
        let mut unchanged: Vec<String> = hosts1.intersection(&hosts2).cloned().collect();

        joined.sort();
        departed.sort();
        unchanged.sort();

        Ok(NetworkDiff {
            scan1_id,
            scan2_id,
            scan1_timestamp: s1.timestamp,
            scan2_timestamp: s2.timestamp,
            joined_hosts: joined,
            departed_hosts: departed,
            unchanged_hosts: unchanged,
        })
    }
}

fn extract_hosts(result_json: &str) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(result_json) {
        if let Some(arr) = val.as_array() {
            for item in arr {
                if let Some(ip) = item.get("ip").and_then(|v| v.as_str()) {
                    set.insert(ip.to_string());
                } else if let Some(ip) = item.get("host").and_then(|v| v.as_str()) {
                    set.insert(ip.to_string());
                }
            }
        } else if let Some(ip) = val.get("ip").and_then(|v| v.as_str()) {
            set.insert(ip.to_string());
        } else if let Some(ip) = val.get("host").and_then(|v| v.as_str()) {
            set.insert(ip.to_string());
        }
    }
    set
}
