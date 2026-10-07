use super::*;

/// A home directory of this test's own, empty and not yet created.
fn scratch_home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("netscli-home-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn history_is_off_unless_asked_for() {
    assert!(!history_requested(None));
    assert!(!history_requested(Some("")));
    assert!(!history_requested(Some("0")));
    assert!(!history_requested(Some("off")));
    assert!(history_requested(Some("1")));
    assert!(history_requested(Some(" True ")));
    assert!(history_requested(Some("yes")));
}

#[tokio::test]
async fn with_history_off_nothing_is_opened_or_created() {
    let home = scratch_home("off");
    std::fs::create_dir_all(&home).unwrap();

    assert!(try_init_db_in(false, Some(home.clone())).await.is_none());

    assert!(!home.join(".netscli").exists(), "a folder appeared");
    std::fs::remove_dir_all(&home).unwrap();
}

#[tokio::test]
async fn with_history_on_the_database_is_created_under_the_home() {
    let home = scratch_home("on");
    std::fs::create_dir_all(&home).unwrap();

    let db = try_init_db_in(true, Some(home.clone())).await;

    assert!(db.is_some());
    assert!(home.join(".netscli").join("netscli.db").is_file());
    // Best effort. SQLite can still hold the file open for a moment on
    // Windows, and the next run clears the folder first anyway.
    drop(db);
    let _ = std::fs::remove_dir_all(&home);
}

#[tokio::test]
async fn with_no_home_no_database_and_no_stray_folder() {
    // Used to fall back to the current directory, which here is the
    // crate's own folder.
    assert!(try_init_db_in(true, None).await.is_none());
    assert!(
        !std::path::Path::new(".netscli").exists(),
        "a .netscli folder was created in the working directory"
    );
}
