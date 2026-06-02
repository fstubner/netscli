use super::Database;
use crate::error::Result;

impl Database {
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
}
