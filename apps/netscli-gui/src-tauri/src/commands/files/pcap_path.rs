use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

use super::preferences::{
    default_save_directory, preferred_save_directory, read_file_save_preferences, timestamp_millis,
};

pub(crate) fn resolve_gui_pcap_output_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
