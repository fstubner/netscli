use tauri::path::BaseDirectory;
use tauri::Manager;

/// The third-party license notices, for the About dialog.
///
/// THIRD-PARTY-NOTICES.txt is a bundle resource (tauri.conf.json), so every
/// installer puts it beside the app as a file people can find without
/// running anything. This reads that copy rather than compiling in a second.
#[tauri::command]
pub(crate) async fn third_party_notices(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .resolve("THIRD-PARTY-NOTICES.txt", BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("{}: {error}", path.display()))
}
