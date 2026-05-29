use std::future::Future;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use netscli_core::{parse_ports_checked, Ops, PcapCancelToken};
use tauri_plugin_dialog::DialogExt;

use crate::state::OperationManager;

type JsonResult = Result<serde_json::Value, String>;

async fn run_json_operation<F, Fut>(
    op_id: Option<String>,
    manager: tauri::State<'_, OperationManager>,
    pcap_cancel: Option<PcapCancelToken>,
    job: F,
) -> JsonResult
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = JsonResult> + Send + 'static,
{
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let _ = tx.send(job().await);
        });

        manager.register(op_id.clone(), handle, pcap_cancel).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        manager.remove(&op_id).await;
        res
    } else {
        job().await
    }
}

#[tauri::command]
pub(crate) async fn cancel_operation(
    op_id: String,
    manager: tauri::State<'_, OperationManager>,
) -> Result<(), String> {
    // Treat missing ids as a no-op so cancellation is idempotent.
    let _ = manager.cancel(&op_id).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn discover_network(
    op_id: Option<String>,
    subnet: Option<String>,
    resolve_hostnames: Option<bool>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let (_subnet, hosts) = ops
            .discover_ipv4(subnet, resolve_hostnames.unwrap_or(false))
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(hosts).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn scan_ports(
    op_id: Option<String>,
    host: String,
    ports: Option<String>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let (_ip, res) = ops
            .scan_ports(&host, ports)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_host_cmd(
    op_id: Option<String>,
    host: String,
    ports: Option<String>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let res = ops
            .inspect_host(host, ports)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn sweep_network(
    op_id: Option<String>,
    subnet: Option<String>,
    ports: Option<String>,
    resolve_hostnames: Option<bool>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let (_subnet, res) = ops
            .sweep_ipv4(subnet, ports, resolve_hostnames.unwrap_or(false))
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn dns_lookup(
    op_id: Option<String>,
    host: String,
    record: Option<String>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let res = ops
            .dns_lookup(&host, record)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_interfaces(
    op_id: Option<String>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        serde_json::to_value(ops.list_interfaces()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_arp_table(
    op_id: Option<String>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let entries = ops.get_arp_table().map_err(|e| e.to_string())?;
        serde_json::to_value(entries).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn capture_pcap(
    op_id: Option<String>,
    interface: String,
    filter: Option<String>,
    duration: Option<u64>,
    max_packets: Option<usize>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    let cancel = op_id.as_ref().map(|_| PcapCancelToken::new());
    let cancel_for_task = cancel.clone();

    run_json_operation(op_id, manager, cancel, move || async move {
        let ops = Ops::default();
        let res = ops
            .capture_pcap_async_with_cancel(
                interface,
                filter,
                duration,
                Some(default_gui_pcap_output_path()?.display().to_string()),
                max_packets,
                cancel_for_task,
            )
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
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

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    dir.push(format!("netscli-capture-{stamp}.pcap"));
    Ok(dir)
}

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
