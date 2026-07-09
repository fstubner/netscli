use std::{future::Future, sync::Arc, time::Duration};

use netscli_core::{parse_ports_checked, Ops, OpsConfig, PcapCancelToken};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use super::files::{ensure_file_size_limit, resolve_gui_pcap_output_path};
use crate::state::{ArtifactRegistry, OperationManager};

type JsonResult = Result<serde_json::Value, String>;
const MAX_GUI_PCAP_IMPORT_BYTES: u64 = 512 * 1024 * 1024;

const OPERATION_PROGRESS_EVENT: &str = "netscli://operation-progress";

#[derive(Clone, serde::Serialize)]
struct OperationProgressPayload {
    op_id: String,
    kind: &'static str,
    phase: Option<&'static str>,
    completed: usize,
    total: usize,
    found: usize,
    target: Option<String>,
    detail: Option<String>,
}

fn emit_operation_progress(app: &tauri::AppHandle, payload: OperationProgressPayload) {
    let _ = app.emit(OPERATION_PROGRESS_EVENT, payload);
}

fn ops_with_concurrency(max_concurrent: Option<usize>) -> Ops {
    let mut cfg = OpsConfig::default();
    if let Some(max_concurrent) = max_concurrent {
        cfg.concurrency = max_concurrent;
    }
    Ops::new(cfg)
}

#[derive(serde::Serialize)]
pub(crate) struct PcapCapability {
    compiled: bool,
    available: bool,
    interfaces: Vec<String>,
    message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct OptionalCapability {
    compiled: bool,
    available: bool,
    message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct ReverseDnsResult {
    ip: String,
    hostname: Option<String>,
}

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
pub(crate) async fn mdns_capability() -> Result<OptionalCapability, String> {
    Ok(OptionalCapability {
        compiled: cfg!(feature = "mdns"),
        available: cfg!(feature = "mdns"),
        message: if cfg!(feature = "mdns") {
            None
        } else {
            Some("mDNS discovery is not included in this build.".to_string())
        },
    })
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
pub(crate) async fn ping_host(
    op_id: Option<String>,
    host: String,
    count: Option<u32>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let count = count.unwrap_or(4).clamp(1, 64);
        let res = ops
            .ping_host_summary(host.trim(), count)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn trace_route_cmd(
    app: tauri::AppHandle,
    op_id: Option<String>,
    host: String,
    max_hops: Option<u32>,
    resolve: Option<bool>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    let progress = op_id.clone().map(|op_id| {
        let app = app.clone();
        let max_hops = max_hops.unwrap_or(30).clamp(1, 255);
        let (tx, mut rx) = tokio::sync::watch::channel(String::new());
        tauri::async_runtime::spawn(async move {
            while rx.changed().await.is_ok() {
                let detail = rx.borrow().clone();
                if detail.trim().is_empty() {
                    continue;
                }
                let completed = trace_progress_hop(&detail).unwrap_or(0) as usize;
                emit_operation_progress(
                    &app,
                    OperationProgressPayload {
                        op_id: op_id.clone(),
                        kind: "trace",
                        phase: Some("tracing"),
                        completed,
                        total: max_hops as usize,
                        found: 0,
                        target: None,
                        detail: Some(detail),
                    },
                );
            }
        });
        tx
    });

    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let res = ops
            .trace_route_with_progress(
                host.trim(),
                max_hops.unwrap_or(30),
                resolve.unwrap_or(false),
                progress,
            )
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    })
    .await
}

fn trace_progress_hop(detail: &str) -> Option<u32> {
    let rest = detail.strip_prefix("hop ")?;
    rest.split('/').next()?.parse().ok()
}

#[tauri::command]
pub(crate) async fn reverse_dns_lookup(
    op_id: Option<String>,
    ip: String,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        let ops = Ops::default();
        let ip = ip.trim().to_string();
        let hostname = ops.reverse_lookup(&ip).await.map_err(|e| e.to_string())?;
        serde_json::to_value(ReverseDnsResult { ip, hostname }).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn discover_mdns(
    op_id: Option<String>,
    timeout_ms: Option<u64>,
    service_types: Option<Vec<String>>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    run_json_operation(op_id, manager, None, move || async move {
        #[cfg(feature = "mdns")]
        {
            let ops = Ops::default();
            let timeout_ms = timeout_ms.unwrap_or(3000).clamp(250, 30_000);
            let service_types = service_types.unwrap_or_default();
            let services = ops
                .discover_mdns(&service_types, Duration::from_millis(timeout_ms))
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_value(services).map_err(|e| e.to_string())
        }

        #[cfg(not(feature = "mdns"))]
        {
            let _ = timeout_ms;
            let _ = service_types;
            Err("mDNS discovery is not included in this build.".to_string())
        }
    })
    .await
}

#[tauri::command]
pub(crate) async fn discover_network(
    app: tauri::AppHandle,
    op_id: Option<String>,
    subnet: Option<String>,
    resolve_hostnames: Option<bool>,
    max_concurrent: Option<usize>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    let progress = op_id.clone().map(|op_id| {
        let app = app.clone();
        Arc::new(move |p: netscli_core::discover::DiscoverProgress| {
            let phase = match p.phase {
                netscli_core::discover::DiscoverPhase::Ping => "probing",
                netscli_core::discover::DiscoverPhase::Resolve => "resolving",
            };
            emit_operation_progress(
                &app,
                OperationProgressPayload {
                    op_id: op_id.clone(),
                    kind: "discover",
                    phase: Some(phase),
                    completed: p.completed,
                    total: p.total,
                    found: p.found,
                    target: Some(p.ip.to_string()),
                    detail: Some(format!(
                        "{} / {} hosts probed, {} found",
                        p.completed, p.total, p.found
                    )),
                },
            );
        }) as Arc<dyn Fn(netscli_core::discover::DiscoverProgress) + Send + Sync>
    });

    run_json_operation(op_id, manager, None, move || async move {
        let ops = ops_with_concurrency(max_concurrent);
        let (_subnet, hosts) = ops
            .discover_ipv4_with_progress(subnet, resolve_hostnames.unwrap_or(false), progress)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(hosts).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn scan_ports(
    app: tauri::AppHandle,
    op_id: Option<String>,
    host: String,
    ports: Option<String>,
    max_concurrent: Option<usize>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    let progress = op_id.clone().map(|op_id| {
        let app = app.clone();
        Arc::new(move |p: netscli_core::scan::PortScanProgress| {
            emit_operation_progress(
                &app,
                OperationProgressPayload {
                    op_id: op_id.clone(),
                    kind: "scan",
                    phase: Some("scanning"),
                    completed: p.completed,
                    total: p.total,
                    found: p.open_found,
                    target: Some(p.port.to_string()),
                    detail: Some(format!(
                        "{} / {} ports checked, {} open",
                        p.completed, p.total, p.open_found
                    )),
                },
            );
        }) as Arc<dyn Fn(netscli_core::scan::PortScanProgress) + Send + Sync>
    });

    run_json_operation(op_id, manager, None, move || async move {
        let ops = ops_with_concurrency(max_concurrent);
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let (_ip, res) = ops
            .scan_ports_with_progress(&host, ports, progress)
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
    app: tauri::AppHandle,
    op_id: Option<String>,
    subnet: Option<String>,
    ports: Option<String>,
    resolve_hostnames: Option<bool>,
    max_concurrent: Option<usize>,
    manager: tauri::State<'_, OperationManager>,
) -> JsonResult {
    let progress = op_id.clone().map(|op_id| {
        let app = app.clone();
        Arc::new(move |p: netscli_core::sweep::SweepProgress| {
            let phase = match p.phase {
                netscli_core::sweep::SweepPhase::DiscoverPing => "probing",
                netscli_core::sweep::SweepPhase::DiscoverResolve => "resolving",
                netscli_core::sweep::SweepPhase::Scan => "scanning",
            };
            let noun = if matches!(p.phase, netscli_core::sweep::SweepPhase::Scan) {
                "responsive hosts scanned"
            } else {
                "hosts probed"
            };
            emit_operation_progress(
                &app,
                OperationProgressPayload {
                    op_id: op_id.clone(),
                    kind: "sweep",
                    phase: Some(phase),
                    completed: p.completed,
                    total: p.total,
                    found: p.found,
                    target: Some(p.ip.to_string()),
                    detail: Some(format!(
                        "{} / {} {noun}, {} with open ports",
                        p.completed, p.total, p.found
                    )),
                },
            );
        }) as Arc<dyn Fn(netscli_core::sweep::SweepProgress) + Send + Sync>
    });

    run_json_operation(op_id, manager, None, move || async move {
        let ops = ops_with_concurrency(max_concurrent);
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let (_subnet, res) = ops
            .sweep_ipv4_with_progress(subnet, ports, resolve_hostnames.unwrap_or(false), progress)
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
