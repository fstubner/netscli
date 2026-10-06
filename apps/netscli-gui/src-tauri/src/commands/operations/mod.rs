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
    if PROGRESS_THROTTLE.should_send(&payload, std::time::Instant::now()) {
        let _ = app.emit(OPERATION_PROGRESS_EVENT, payload);
    }
}

/// At most one progress event per operation every this often, plus the
/// first, the last, and every change of phase.
///
/// The core reports every port and every host, and each report was one IPC
/// event and one React state update: 4,096 of them for a full port scan, most
/// arriving inside a second. Ten a second is as fast as a progress bar can be
/// read.
const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

static PROGRESS_THROTTLE: ProgressThrottle = ProgressThrottle::new();

/// When each operation last sent an event, and in which phase.
type LastSent = HashMap<String, (std::time::Instant, Option<&'static str>)>;

struct ProgressThrottle(std::sync::Mutex<Option<LastSent>>);

impl ProgressThrottle {
    const fn new() -> Self {
        Self(std::sync::Mutex::new(None))
    }

    fn should_send(&self, payload: &OperationProgressPayload, now: std::time::Instant) -> bool {
        let mut guard = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let last = guard.get_or_insert_with(HashMap::new);
        let finished = payload.total > 0 && payload.completed >= payload.total;
        let send = match last.get(&payload.op_id) {
            None => true,
            Some((at, phase)) => {
                finished || *phase != payload.phase || now.duration_since(*at) >= PROGRESS_INTERVAL
            }
        };
        if finished {
            // The operation is done, or this phase of it is; a later phase
            // starts a new entry with its own first event.
            last.remove(&payload.op_id);
        } else if send {
            last.insert(payload.op_id.clone(), (now, payload.phase));
        }
        send
    }
}

#[cfg(test)]
mod progress_throttle_tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn event(
        op: &str,
        phase: &'static str,
        completed: usize,
        total: usize,
    ) -> OperationProgressPayload {
        OperationProgressPayload {
            op_id: op.into(),
            kind: "scan",
            phase: Some(phase),
            completed,
            total,
            found: 0,
            target: None,
            detail: None,
        }
    }

    #[test]
    fn a_full_port_scan_inside_one_interval_sends_the_first_and_last_event_only() {
        let throttle = ProgressThrottle::new();
        let start = Instant::now();
        let sent = (1..=4096)
            .filter(|&n| throttle.should_send(&event("op", "scanning", n, 4096), start))
            .count();
        assert_eq!(sent, 2);
    }

    #[test]
    fn events_resume_after_the_interval_and_on_a_phase_change() {
        let throttle = ProgressThrottle::new();
        let t = Instant::now();
        assert!(throttle.should_send(&event("op", "ping", 1, 254), t));
        assert!(!throttle.should_send(&event("op", "ping", 2, 254), t + Duration::from_millis(50)));
        assert!(throttle.should_send(&event("op", "ping", 3, 254), t + Duration::from_millis(120)));
        assert!(throttle.should_send(
            &event("op", "resolve", 1, 10),
            t + Duration::from_millis(121)
        ));
    }

    #[test]
    fn operations_are_throttled_separately() {
        let throttle = ProgressThrottle::new();
        let t = Instant::now();
        assert!(throttle.should_send(&event("a", "scanning", 1, 10), t));
        assert!(throttle.should_send(&event("b", "scanning", 1, 10), t));
    }
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
        match rx.await {
            Ok(result) => result,
            Err(_) => {
                // The sender was dropped without sending. That happens when the
                // task is aborted -- a real cancel -- and also when it panics,
                // and both used to be reported to the user as "Operation
                // cancelled": a crash in the scanner was indistinguishable from
                // the user pressing Stop, and nothing recorded it anywhere.
                //
                // `cancel` removes the entry before aborting, so a still
                // registered operation was not cancelled by anyone.
                if manager.is_registered(&op_id).await {
                    // Reaches a terminal only in a debug build; release sets
                    // windows_subsystem = "windows" and has no console. The
                    // returned message is what the user actually sees.
                    eprintln!("operation {op_id} ended without returning a result");
                    Err(
                        "The operation stopped unexpectedly and produced no result. This is a fault in NetsCLI, not a cancellation."
                            .to_string(),
                    )
                } else {
                    Err("Operation cancelled".to_string())
                }
            }
        }
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
