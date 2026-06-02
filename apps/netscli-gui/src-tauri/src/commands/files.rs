use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::state::ArtifactRegistry;

const SAVE_SETTINGS_FILE: &str = "gui-save-settings.json";
const LEGACY_CAPTURE_SETTINGS_FILE: &str = "gui-capture-settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct FileSavePreferences {
    ask_each_time: bool,
    default_directory: Option<String>,
}

#[tauri::command]
pub(crate) fn export_text_file(
    app: tauri::AppHandle,
    artifact_registry: State<'_, ArtifactRegistry>,
    filename: String,
    contents: String,
    target_path: Option<String>,
) -> Result<String, String> {
    let filename = sanitize_export_filename(&filename)?;
    if target_path.is_some_and(|path| !path.trim().is_empty()) {
        return Err(
            "Renderer-supplied export paths are not accepted; use the native save dialog"
                .to_string(),
        );
    }

    let path = resolve_export_path(&app, &filename)?;

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create export directory: {e}"))?;
    }

    std::fs::write(&path, contents).map_err(|e| format!("Failed to write export: {e}"))?;
    artifact_registry.register(&path)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) fn open_saved_artifact(
    app: tauri::AppHandle,
    artifact_registry: State<'_, ArtifactRegistry>,
    path: String,
) -> Result<(), String> {
    let path = validate_saved_artifact_path(&path, &artifact_registry)?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open artifact: {e}"))
}

#[tauri::command]
pub(crate) fn reveal_saved_artifact(
    app: tauri::AppHandle,
    artifact_registry: State<'_, ArtifactRegistry>,
    path: String,
) -> Result<(), String> {
    let path = validate_saved_artifact_path(&path, &artifact_registry)?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal artifact: {e}"))
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

pub(super) fn resolve_gui_pcap_output_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if std::env::var_os("NETSCLI_EXPORT_DIR").is_some() {
        return default_gui_pcap_output_path();
    }

    let prefs = read_file_save_preferences()?;
    if prefs.ask_each_time {
        return ask_gui_pcap_output_path(app, prefs.default_directory.as_deref());
    }

    if let Some(dir) = prefs
        .default_directory
        .filter(|path| !path.trim().is_empty())
    {
        return capture_path_in_directory(PathBuf::from(dir));
    }

    capture_path_in_directory(default_save_directory()?)
}

fn default_gui_pcap_output_path() -> Result<PathBuf, String> {
    let mut dir = match std::env::var_os("NETSCLI_EXPORT_DIR") {
        Some(path) => PathBuf::from(path),
        None => default_save_directory()?,
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create packet capture directory: {e}"))?;

    let stamp = timestamp_millis();
    dir.push(format!("netscli-capture-{stamp}.pcap"));
    Ok(dir)
}

fn capture_path_in_directory(mut dir: PathBuf) -> Result<PathBuf, String> {
    if dir.exists() && !dir.is_dir() {
        return Err("Configured packet capture path is not a directory".to_string());
    }
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create packet capture directory: {e}"))?;

    let stamp = timestamp_millis();
    dir.push(format!("netscli-capture-{stamp}.pcap"));
    Ok(dir)
}

fn ask_gui_pcap_output_path(
    app: &tauri::AppHandle,
    default_directory: Option<&str>,
) -> Result<PathBuf, String> {
    let filename = format!("netscli-capture-{}.pcap", timestamp_millis());
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save Packet Capture")
        .set_file_name(&filename)
        .set_can_create_directories(true)
        .add_filter("Packet Capture", &["pcap"]);

    if let Some(directory) = preferred_save_directory(default_directory)? {
        dialog = dialog.set_directory(directory);
    }

    let selected = dialog
        .blocking_save_file()
        .ok_or_else(|| "Capture cancelled".to_string())?;

    let mut path = selected
        .into_path()
        .map_err(|_| "Selected packet capture path is not a local filesystem path".to_string())?;

    if path.file_name().is_none() {
        return Err("Packet capture path must include a filename".to_string());
    }
    if path.exists() && path.is_dir() {
        return Err("Packet capture path must be a file".to_string());
    }

    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
    {
        Some(ext) if ext == "pcap" => {}
        Some(_) => return Err("Packet capture file must end in .pcap".to_string()),
        None => {
            path.set_extension("pcap");
        }
    }

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create packet capture directory: {e}"))?;
    }

    Ok(path)
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

fn read_file_save_preferences() -> Result<FileSavePreferences, String> {
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

fn resolve_export_path(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    if let Some(mut path) = std::env::var_os("NETSCLI_EXPORT_DIR").map(PathBuf::from) {
        path.push(filename);
        return Ok(path);
    }

    let prefs = read_file_save_preferences()?;
    if !prefs.ask_each_time {
        let dir = match prefs
            .default_directory
            .filter(|path| !path.trim().is_empty())
        {
            Some(path) => PathBuf::from(path),
            None => default_save_directory()?,
        };
        return export_path_in_directory(dir, filename);
    }

    let dialog_path = ask_export_path(app, filename, prefs.default_directory.as_deref())?;
    Ok(dialog_path)
}

fn ask_export_path(
    app: &tauri::AppHandle,
    filename: &str,
    default_directory: Option<&str>,
) -> Result<PathBuf, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save NetsCLI Export")
        .set_file_name(filename)
        .set_can_create_directories(true);

    if let Some((name, extensions)) = export_filter(filename) {
        dialog = dialog.add_filter(name, &extensions);
    }
    if let Some(directory) = preferred_save_directory(default_directory)? {
        dialog = dialog.set_directory(directory);
    }

    let selected = dialog
        .blocking_save_file()
        .ok_or_else(|| "Export cancelled".to_string())?;

    let path = selected
        .into_path()
        .map_err(|_| "Selected export path is not a local filesystem path".to_string())?;

    if path.file_name().is_none() {
        return Err("Export path must include a filename".to_string());
    }
    if path.exists() && path.is_dir() {
        return Err("Export path must be a file".to_string());
    }

    Ok(path)
}

fn preferred_save_directory(directory: Option<&str>) -> Result<Option<PathBuf>, String> {
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

fn default_save_directory() -> Result<PathBuf, String> {
    let mut dir = dirs::download_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve save directory".to_string())?;
    dir.push("NetsCLI");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create save directory: {e}"))?;
    Ok(dir)
}

fn export_path_in_directory(mut dir: PathBuf, filename: &str) -> Result<PathBuf, String> {
    if dir.exists() && !dir.is_dir() {
        return Err("Configured save path is not a directory".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create save directory: {e}"))?;
    dir.push(filename);
    Ok(dir)
}

fn validate_saved_artifact_path(
    path: &str,
    artifact_registry: &ArtifactRegistry,
) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Artifact path is empty".to_string());
    }

    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Artifact path is not accessible: {e}"))?;
    if !canonical.is_file() {
        return Err("Artifact path must be a file".to_string());
    }
    if !has_supported_artifact_extension(&canonical) {
        return Err("Artifact type is not supported".to_string());
    }

    if artifact_registry.contains(&canonical)? || is_in_allowed_save_root(&canonical)? {
        Ok(canonical)
    } else {
        Err(
            "Artifact path was not created by NetsCLI or is outside the configured save folder"
                .to_string(),
        )
    }
}

fn has_supported_artifact_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "pcap" | "json" | "csv" | "txt"
            )
        })
        .unwrap_or(false)
}

fn is_in_allowed_save_root(path: &Path) -> Result<bool, String> {
    let mut roots = Vec::new();
    if let Some(path) = std::env::var_os("NETSCLI_EXPORT_DIR") {
        roots.push(PathBuf::from(path));
    }

    if let Ok(prefs) = read_file_save_preferences() {
        if let Some(path) = prefs
            .default_directory
            .filter(|value| !value.trim().is_empty())
        {
            roots.push(PathBuf::from(path));
        }
    }

    roots.push(default_save_directory()?);

    for root in roots {
        let Ok(root) = std::fs::canonicalize(root) else {
            continue;
        };
        if path.starts_with(root) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn export_filter(filename: &str) -> Option<(&'static str, [&'static str; 1])> {
    match PathBuf::from(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("json") => Some(("JSON", ["json"])),
        Some("csv") => Some(("CSV", ["csv"])),
        Some("txt") => Some(("Text", ["txt"])),
        _ => None,
    }
}

fn sanitize_export_filename(filename: &str) -> Result<String, String> {
    let cleaned = filename
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return Err("Invalid export filename".to_string());
    }

    let path = PathBuf::from(&cleaned);
    if path.components().count() != 1 {
        return Err("Export filename must not include a path".to_string());
    }

    Ok(cleaned)
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
