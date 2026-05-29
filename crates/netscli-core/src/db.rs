mod history;
mod hosts;
mod models;
mod schema;

#[cfg(test)]
mod tests;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use std::path::PathBuf;

use crate::error::Result;

pub use models::{HostRecord, ScanHistoryRecord};

pub struct Database {
    pub(super) pool: SqlitePool,
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
}
