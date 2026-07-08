use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

const SAVE_SETTINGS_FILE: &str = "gui-save-settings.json";
const LEGACY_CAPTURE_SETTINGS_FILE: &str = "gui-capture-settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct FileSavePreferences {
    pub(super) ask_each_time: bool,
    pub(super) default_directory: Option<String>,
}

#[tauri::command]
pub(crate) fn get_file_save_preferences() -> Result<FileSavePreferences, String> {
    read_file_save_preferences()
}

#[tauri::command]
pub(crate) fn set_file_save_ask_each_time(
    ask_each_time: bool,
) -> Result<FileSavePreferences, String> {
    let mut prefs = read_file_save_preferences()?;
    prefs.ask_each_time = ask_each_time;
    write_file_save_preferences(&prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub(crate) fn choose_file_save_default_directory(
    app: tauri::AppHandle,
) -> Result<FileSavePreferences, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Choose NetsCLI Save Folder")
        .set_can_create_directories(true)
        .blocking_pick_folder()
        .ok_or_else(|| "Folder selection cancelled".to_string())?;

    let path = selected
        .into_path()
        .map_err(|_| "Selected save folder is not a local filesystem path".to_string())?;

    if path.exists() && !path.is_dir() {
        return Err("Save folder must be a directory".to_string());
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create save directory: {e}"))?;

    let mut prefs = read_file_save_preferences()?;
    prefs.default_directory = Some(path.display().to_string());
    write_file_save_preferences(&prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub(crate) fn clear_file_save_default_directory() -> Result<FileSavePreferences, String> {
    let mut prefs = read_file_save_preferences()?;
    prefs.default_directory = None;
    write_file_save_preferences(&prefs)?;
    Ok(prefs)
}

fn save_settings_path() -> Result<PathBuf, String> {
    let mut dir = dirs::config_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve app config directory".to_string())?;
    dir.push("NetsCLI");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app config directory: {e}"))?;
    dir.push(SAVE_SETTINGS_FILE);
    Ok(dir)
}

fn legacy_capture_settings_path() -> Result<PathBuf, String> {
    let mut dir = dirs::config_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve app config directory".to_string())?;
    dir.push("NetsCLI");
    dir.push(LEGACY_CAPTURE_SETTINGS_FILE);
    Ok(dir)
}

pub(super) fn read_file_save_preferences() -> Result<FileSavePreferences, String> {
    let path = save_settings_path()?;
    if !path.exists() {
        let legacy_path = legacy_capture_settings_path()?;
        if legacy_path.exists() {
            let text = std::fs::read_to_string(&legacy_path)
                .map_err(|e| format!("Failed to read legacy save settings: {e}"))?;
            return serde_json::from_str(&text)
                .map_err(|e| format!("Failed to parse legacy save settings: {e}"));
        }
        return Ok(FileSavePreferences::default());
    }
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read save settings: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse save settings: {e}"))
}

fn write_file_save_preferences(prefs: &FileSavePreferences) -> Result<(), String> {
    let path = save_settings_path()?;
    let text = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("Failed to serialize save settings: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("Failed to write save settings: {e}"))
}

pub(super) fn preferred_save_directory(directory: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(directory) = directory.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(directory);
    if path.exists() && !path.is_dir() {
        return Err("Configured save path is not a directory".to_string());
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create save directory: {e}"))?;
    Ok(Some(path))
}

pub(super) fn default_save_directory() -> Result<PathBuf, String> {
    let mut dir = dirs::download_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve save directory".to_string())?;
    dir.push("NetsCLI");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create save directory: {e}"))?;
    Ok(dir)
}

pub(super) fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub(super) fn format_byte_limit(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    if bytes >= MIB && bytes.is_multiple_of(MIB) {
        format!("{} MiB", bytes / MIB)
    } else {
        format!("{bytes} bytes")
    }
}
