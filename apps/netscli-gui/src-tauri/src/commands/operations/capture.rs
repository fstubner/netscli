use netscli_core::{Ops, PcapCancelToken};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::{run_json_operation, JsonResult};
use crate::commands::files::{ensure_file_size_limit, resolve_gui_pcap_output_path};
use crate::state::{ArtifactRegistry, OperationManager};

const MAX_GUI_PCAP_IMPORT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(serde::Serialize)]
pub(crate) struct PcapCapability {
    compiled: bool,
    available: bool,
    interfaces: Vec<String>,
    message: Option<String>,
}

#[tauri::command]
pub(crate) async fn pcap_capability() -> Result<PcapCapability, String> {
    let ops = Ops::default();
    Ok(match ops.pcap_check_support() {
        Ok(interfaces) => PcapCapability {
            compiled: true,
            available: true,
            interfaces,
            message: None,
        },
        Err(error) => PcapCapability {
            compiled: cfg!(feature = "pcap"),
            available: false,
            interfaces: Vec::new(),
            message: Some(error.to_string()),
        },
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn capture_pcap(
    app: tauri::AppHandle,
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
        let output_path = resolve_gui_pcap_output_path(&app)?;
        let res = ops
            .capture_pcap_async_with_cancel(
                interface,
                filter,
                duration,
                Some(output_path.display().to_string()),
                max_packets,
                cancel_for_task,
            )
            .await
            .map_err(|e| e.to_string())?;
        app.state::<ArtifactRegistry>().register(&res.file_path)?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn open_pcap_file(
    app: tauri::AppHandle,
    artifact_registry: tauri::State<'_, ArtifactRegistry>,
    max_packets: Option<usize>,
) -> JsonResult {
    let path = app
        .dialog()
        .file()
        .set_title("Open Packet Capture")
        .add_filter("Packet Capture", &["pcap"])
        .blocking_pick_file()
        .ok_or_else(|| "Open capture cancelled".to_string())?;
    let path = path
        .into_path()
        .map_err(|_| "Selected packet capture is not a local filesystem path".to_string())?;
    ensure_file_size_limit(&path, MAX_GUI_PCAP_IMPORT_BYTES, "Packet capture")?;

    let ops = Ops::default();
    let parsed = ops
        .parse_pcap_file(path.display().to_string(), max_packets)
        .map_err(|e| e.to_string())?;
    artifact_registry.register(&path)?;
    serde_json::to_value(parsed).map_err(|e| e.to_string())
}
