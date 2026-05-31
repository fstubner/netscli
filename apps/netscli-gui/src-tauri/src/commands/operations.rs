use std::future::Future;

use netscli_core::{parse_ports_checked, Ops, PcapCancelToken};

use super::files::resolve_gui_pcap_output_path;
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
#[allow(clippy::too_many_arguments)]
pub(crate) async fn capture_pcap(
    app: tauri::AppHandle,
    op_id: Option<String>,
    interface: String,
    filter: Option<String>,
    duration: Option<u64>,
    max_packets: Option<usize>,
    output_mode: Option<String>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    let cancel = op_id.as_ref().map(|_| PcapCancelToken::new());
    let cancel_for_task = cancel.clone();

    run_json_operation(op_id, manager, cancel, move || async move {
        let ops = Ops::default();
        let output_path = resolve_gui_pcap_output_path(&app, output_mode.as_deref())?;
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
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}
