use std::sync::Arc;

use netscli_core::{parse_ports_checked, Ops};

use super::{
    emit_operation_progress, ops_with_concurrency, run_json_operation, JsonResult,
    OperationProgressPayload,
};
use crate::state::OperationManager;

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
