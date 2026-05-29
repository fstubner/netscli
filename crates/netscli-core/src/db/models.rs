use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

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
