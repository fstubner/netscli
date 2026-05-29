use tempfile::TempDir;

use super::schema::CURRENT_SCHEMA_VERSION;
use super::Database;

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
