use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) fn export_text_file(
    app: tauri::AppHandle,
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
    Ok(path.display().to_string())
}

pub(super) fn resolve_gui_pcap_output_path(
    app: &tauri::AppHandle,
    output_mode: Option<&str>,
) -> Result<PathBuf, String> {
    if output_mode.is_some_and(|mode| mode.eq_ignore_ascii_case("ask"))
        && std::env::var_os("NETSCLI_EXPORT_DIR").is_none()
    {
        return ask_gui_pcap_output_path(app);
    }

    default_gui_pcap_output_path()
}

fn default_gui_pcap_output_path() -> Result<PathBuf, String> {
    let mut dir = std::env::var_os("NETSCLI_EXPORT_DIR")
        .map(PathBuf::from)
        .or_else(dirs::download_dir)
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve packet capture directory".to_string())?;
    dir.push("NetsCLI");
    dir.push("captures");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create packet capture directory: {e}"))?;

    let stamp = timestamp_millis();
    dir.push(format!("netscli-capture-{stamp}.pcap"));
    Ok(dir)
}

fn ask_gui_pcap_output_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let filename = format!("netscli-capture-{}.pcap", timestamp_millis());
    let selected = app
        .dialog()
        .file()
        .set_title("Save Packet Capture")
        .set_file_name(&filename)
        .set_can_create_directories(true)
        .add_filter("Packet Capture", &["pcap"])
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

fn resolve_export_path(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    if let Some(mut path) = std::env::var_os("NETSCLI_EXPORT_DIR").map(PathBuf::from) {
        path.push(filename);
        return Ok(path);
    }

    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save NetsCLI Export")
        .set_file_name(filename)
        .set_can_create_directories(true);

    if let Some((name, extensions)) = export_filter(filename) {
        dialog = dialog.add_filter(name, &extensions);
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
