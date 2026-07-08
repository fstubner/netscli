use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_dialog::DialogExt;

use super::preferences::{
    default_save_directory, format_byte_limit, preferred_save_directory,
    read_file_save_preferences, timestamp_millis,
};
use crate::state::ArtifactRegistry;

const MAX_RESULT_BUNDLE_BYTES: u64 = 25 * 1024 * 1024;

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
pub(crate) fn save_result_bundle(
    app: tauri::AppHandle,
    artifact_registry: State<'_, ArtifactRegistry>,
    contents: String,
) -> Result<String, String> {
    if contents.len() as u64 > MAX_RESULT_BUNDLE_BYTES {
        return Err(format!(
            "Result bundle is too large (max {})",
            format_byte_limit(MAX_RESULT_BUNDLE_BYTES)
        ));
    }
    let filename = format!("netscli-result-{}.netscli-result.json", timestamp_millis());
    export_text_file(app, artifact_registry, filename, contents, None)
}

#[tauri::command]
pub(crate) fn open_result_bundle(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open NetsCLI Result")
        .add_filter("NetsCLI Result", &["json"])
        .blocking_pick_file()
        .ok_or_else(|| "Open result cancelled".to_string())?;
    let path = selected
        .into_path()
        .map_err(|_| "Selected result is not a local filesystem path".to_string())?;
    if !path.is_file() {
        return Err("Result path must be a file".to_string());
    }
    ensure_file_size_limit(&path, MAX_RESULT_BUNDLE_BYTES, "Result bundle")?;
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read result bundle: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse result bundle: {e}"))
}

pub(crate) fn ensure_file_size_limit(
    path: &Path,
    max_bytes: u64,
    label: &str,
) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to inspect {label}: {e}"))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "{label} is too large (max {})",
            format_byte_limit(max_bytes)
        ));
    }
    Ok(())
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

fn export_path_in_directory(mut dir: PathBuf, filename: &str) -> Result<PathBuf, String> {
    if dir.exists() && !dir.is_dir() {
        return Err("Configured save path is not a directory".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create save directory: {e}"))?;
    dir.push(filename);
    Ok(dir)
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
