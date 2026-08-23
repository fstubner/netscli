mod capture;
mod lookup;
mod scan;

pub(crate) use capture::{capture_pcap, open_pcap_file, pcap_capability};
pub(crate) use lookup::{
    clear_arp_table, discover_mdns, dns_lookup, get_arp_table, list_interfaces, mdns_capability,
    reverse_dns_lookup,
};
pub(crate) use scan::{
    discover_network, inspect_host_cmd, ping_host, scan_ports, sweep_network, trace_route_cmd,
};

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use netscli_core::{Ops, OpsConfig};
use tauri::Emitter;
use tokio::sync::Mutex as AsyncMutex;

use crate::state::{OperationHandle, OperationManager};

pub(super) type JsonResult = Result<serde_json::Value, String>;

const OPERATION_PROGRESS_EVENT: &str = "netscli://operation-progress";

#[derive(Clone, serde::Serialize)]
pub(super) struct OperationProgressPayload {
    pub(super) op_id: String,
    pub(super) kind: &'static str,
    pub(super) phase: Option<&'static str>,
    pub(super) completed: usize,
    pub(super) total: usize,
    pub(super) found: usize,
    pub(super) target: Option<String>,
    pub(super) detail: Option<String>,
}

pub(super) fn emit_operation_progress(app: &tauri::AppHandle, payload: OperationProgressPayload) {
    let _ = app.emit(OPERATION_PROGRESS_EVENT, payload);
}

pub(super) fn ops_with_concurrency(max_concurrent: Option<usize>) -> Ops {
    let mut cfg = OpsConfig::default();
    if let Some(max_concurrent) = max_concurrent {
        cfg.concurrency = max_concurrent;
    }
    Ops::new(cfg)
}

pub(super) async fn run_json_operation<F, Fut>(
    op_id: Option<String>,
    manager: tauri::State<'_, OperationManager>,
    pcap_cancel: Option<netscli_core::PcapCancelToken>,
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

        // Constructed *after* `register`, so its `Drop` can never run before
        // the entry it removes exists. Cleanup used to sit after the `await`
        // below, which meant a dropped invoke future -- a webview reload
        // mid-run -- skipped it and left the entry in the map for good.
        let _cleanup = RemoveOnDrop {
            registry: manager.registry(),
            op_id: op_id.clone(),
        };
        rx.await.map_err(|_| "Operation cancelled".to_string())?
    } else {
        job().await
    }
}

/// Removes an operation from the manager however its future ends: returned,
/// errored, or dropped.
struct RemoveOnDrop {
    registry: Arc<AsyncMutex<HashMap<String, OperationHandle>>>,
    op_id: String,
}

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        // `Drop` cannot await, so the removal is spawned. Nothing waits on
        // the entry being gone -- op ids are unique per run, so a late
        // removal cannot strand a later operation.
        let registry = Arc::clone(&self.registry);
        let op_id = std::mem::take(&mut self.op_id);
        tauri::async_runtime::spawn(async move {
            registry.lock().await.remove(&op_id);
        });
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
