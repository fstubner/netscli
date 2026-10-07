use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

use super::dialog;

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
pub(crate) async fn choose_file_save_default_directory(
    app: tauri::AppHandle,
) -> Result<FileSavePreferences, String> {
    let picker = app
        .dialog()
        .file()
        .set_title("Choose NetsCLI Save Folder")
        .set_can_create_directories(true);
    let selected = dialog::ask(|done| picker.pick_folder(done))
        .await
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
            return Ok(parse_preferences(&text, LEGACY_CAPTURE_SETTINGS_FILE));
        }
        return Ok(FileSavePreferences::default());
    }
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read save settings: {e}"))?;
    Ok(parse_preferences(&text, SAVE_SETTINGS_FILE))
}

/// A settings file that does not parse reads as the defaults.
///
/// It used to be an error, and every export and capture reads these settings
/// first, so one damaged file stopped all of them. The Settings controls could
/// not repair it either: each one reads the file before it writes it. Reading
/// the defaults lets the next change write a good file over the bad one. The
/// cost is that a save folder the user had chosen is forgotten, which is
/// better than nothing being saveable.
fn parse_preferences(text: &str, file: &str) -> FileSavePreferences {
    serde_json::from_str(text).unwrap_or_else(|error| {
        // Only a debug build has anywhere to show this; the release app has no
        // console.
        eprintln!("netscli-gui: {file} could not be read, using the defaults: {error}");
        FileSavePreferences::default()
    })
}

fn write_file_save_preferences(prefs: &FileSavePreferences) -> Result<(), String> {
    let path = save_settings_path()?;
    let text = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("Failed to serialize save settings: {e}"))?;
    replace_file(&path, &text).map_err(|e| format!("Failed to write save settings: {e}"))
}

/// Write beside the file and rename over it, so an interruption leaves the old
/// settings in place rather than a truncated file.
fn replace_file(path: &Path, text: &str) -> std::io::Result<()> {
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text)?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_damaged_settings_file_reads_as_the_defaults() {
        // Truncated by a crash mid-write, empty, and the wrong shape.
        for text in [
            "",
            "{\"ask_each_time\": tr",
            "not json",
            "{\"ask_each_time\": \"yes\"}",
        ] {
            let prefs = parse_preferences(text, SAVE_SETTINGS_FILE);
            assert!(!prefs.ask_each_time, "{text:?}");
            assert_eq!(prefs.default_directory, None, "{text:?}");
        }
    }

    #[test]
    fn a_good_settings_file_is_read_as_written() {
        let prefs = parse_preferences(
            r#"{"ask_each_time": true, "default_directory": "D:\\Scans"}"#,
            SAVE_SETTINGS_FILE,
        );
        assert!(prefs.ask_each_time);
        assert_eq!(prefs.default_directory.as_deref(), Some("D:\\Scans"));
    }

    #[test]
    fn replacing_a_file_swaps_its_contents_and_leaves_no_temporary_behind() {
        let dir = std::env::temp_dir().join(format!("netscli-prefs-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gui-save-settings.json");

        replace_file(&path, "old").unwrap();
        replace_file(&path, "new").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["gui-save-settings.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
