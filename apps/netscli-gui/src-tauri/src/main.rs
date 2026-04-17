// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use netscli_core::{parse_ports_checked, NetworkMonitor, Ops, PcapCancelToken};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
struct OperationManager {
    tasks: AsyncMutex<HashMap<String, OperationHandle>>,
}

struct OperationHandle {
    task: tauri::async_runtime::JoinHandle<()>,
    pcap_cancel: Option<PcapCancelToken>,
}

impl OperationManager {
    async fn register(
        &self,
        op_id: String,
        task: tauri::async_runtime::JoinHandle<()>,
        pcap_cancel: Option<PcapCancelToken>,
    ) {
        let mut tasks = self.tasks.lock().await;

        // If an op_id is re-used, cancel the previous one.
        if let Some(prev) = tasks.insert(op_id, OperationHandle { task, pcap_cancel }) {
            if let Some(token) = prev.pcap_cancel {
                token.cancel();
            }
            prev.task.abort();
        }
    }

    async fn remove(&self, op_id: &str) {
        let mut tasks = self.tasks.lock().await;
        tasks.remove(op_id);
    }

    async fn cancel(&self, op_id: &str) -> bool {
        let mut tasks = self.tasks.lock().await;
        if let Some(handle) = tasks.remove(op_id) {
            if let Some(token) = handle.pcap_cancel {
                token.cancel();
            }
            handle.task.abort();
            true
        } else {
            false
        }
    }
}

#[tauri::command]
async fn cancel_operation(
    op_id: String,
    ops: tauri::State<'_, OperationManager>,
) -> Result<(), String> {
    // Treat missing ids as a no-op so cancellation is idempotent.
    let _ = ops.cancel(&op_id).await;
    Ok(())
}

#[tauri::command]
async fn discover_network(
    op_id: Option<String>,
    subnet: Option<String>,
    resolve_hostnames: Option<bool>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let (_subnet, hosts) = ops
                    .discover_ipv4(subnet, resolve_hostnames.unwrap_or(false))
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::to_value(hosts).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let (_subnet, hosts) = ops
            .discover_ipv4(subnet, resolve_hostnames.unwrap_or(false))
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(hosts).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn scan_ports(
    op_id: Option<String>,
    host: String,
    ports: Option<String>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let host_for_task = host.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
                let (_ip, res) = ops
                    .scan_ports(&host_for_task, ports)
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::to_value(res).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let (_ip, res) = ops
            .scan_ports(&host, ports)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn inspect_host_cmd(
    op_id: Option<String>,
    host: String,
    ports: Option<String>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
                let res = ops
                    .inspect_host(host, ports)
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::to_value(res).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let res = ops
            .inspect_host(host, ports)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn sweep_network(
    op_id: Option<String>,
    subnet: Option<String>,
    ports: Option<String>,
    resolve_hostnames: Option<bool>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
                let (_subnet, res) = ops
                    .sweep_ipv4(subnet, ports, resolve_hostnames.unwrap_or(false))
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::to_value(res).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let ports = parse_ports_checked(ports.as_deref()).map_err(|e| e.to_string())?;
        let (_subnet, res) = ops
            .sweep_ipv4(subnet, ports, resolve_hostnames.unwrap_or(false))
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn dns_lookup(
    op_id: Option<String>,
    host: String,
    record: Option<String>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let host_for_task = host.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let res = ops
                    .dns_lookup(&host_for_task, record)
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::to_value(res).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let res = ops
            .dns_lookup(&host, record)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn list_interfaces(
    op_id: Option<String>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                serde_json::to_value(ops.list_interfaces()).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        serde_json::to_value(ops.list_interfaces()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn get_arp_table(
    op_id: Option<String>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let entries = ops.get_arp_table().map_err(|e| e.to_string())?;
                serde_json::to_value(entries).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, None).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let entries = ops.get_arp_table().map_err(|e| e.to_string())?;
        serde_json::to_value(entries).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn capture_pcap(
    op_id: Option<String>,
    interface: String,
    filter: Option<String>,
    duration: Option<u64>,
    max_packets: Option<usize>,
    ops: tauri::State<'_, OperationManager>,
) -> Result<serde_json::Value, String> {
    if let Some(op_id) = op_id {
        let cancel = PcapCancelToken::new();
        let cancel_for_task = cancel.clone();

        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            let res: Result<serde_json::Value, String> = async {
                let ops = Ops::default();
                let res = ops
                    .capture_pcap_async_with_cancel(
                        interface,
                        filter,
                        duration,
                        None,
                        max_packets,
                        Some(cancel_for_task),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::to_value(res).map_err(|e| e.to_string())
            }
            .await;
            let _ = tx.send(res);
        });

        ops.register(op_id.clone(), handle, Some(cancel)).await;
        let res = rx.await.map_err(|_| "Operation cancelled".to_string())?;
        ops.remove(&op_id).await;
        res
    } else {
        let ops = Ops::default();
        let res = ops
            .capture_pcap_async(interface, filter, duration, None, max_packets)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_value(res).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn get_network_stats(
    monitor: tauri::State<'_, Mutex<NetworkMonitor>>,
) -> Result<serde_json::Value, String> {
    let monitor = monitor
        .lock()
        .map_err(|e| format!("Failed to acquire monitor lock: {e}"))?;
    let stats = monitor.get_stats();
    serde_json::to_value(stats).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_default_interface() -> Result<serde_json::Value, String> {
    let ops = Ops::default();
    let ifaces = ops.list_interfaces();
    // Find first non-loopback, up interface
    let default = ifaces
        .iter()
        .find(|i| i.is_up && !i.is_loopback)
        .or_else(|| ifaces.first());

    match default {
        Some(iface) => {
            let result = serde_json::json!({
                "name": iface.name,
                "ips": iface.ips.iter().map(|ip| ip.to_string()).collect::<Vec<_>>(),
                "is_up": iface.is_up
            });
            Ok(result)
        }
        None => Err("No network interface found".to_string()),
    }
}

fn main() {
    // Set OUI database path for dev builds so vendor lookup works.
    // Release builds pick up the bundled resource via Tauri and the
    // library's include_bytes! fallback handles cargo install users,
    // so this is only for `npm run tauri dev` from the crate dir.
    #[cfg(debug_assertions)]
    if std::env::var("NETSCLI_OUI_PATH").is_err() {
        let candidates = [
            "data/oui.min.json.gz",
            "../../../crates/netscli-core/data/oui.min.json.gz",
            "../../crates/netscli-core/data/oui.min.json.gz",
        ];
        for cand in candidates {
            if std::path::Path::new(cand).exists() {
                unsafe { std::env::set_var("NETSCLI_OUI_PATH", cand) };
                break;
            }
        }
    }

    let monitor = NetworkMonitor::new();

    tauri::Builder::default()
        .manage(Mutex::new(monitor))
        .manage(OperationManager::default())
        .invoke_handler(tauri::generate_handler![
            cancel_operation,
            discover_network,
            scan_ports,
            inspect_host_cmd,
            sweep_network,
            dns_lookup,
            list_interfaces,
            get_arp_table,
            capture_pcap,
            get_network_stats,
            get_default_interface
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
