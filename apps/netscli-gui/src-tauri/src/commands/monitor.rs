use std::sync::Mutex;

use netscli_core::{NetworkMonitor, Ops};

#[tauri::command]
pub(crate) async fn get_network_stats(
    interface: Option<String>,
    monitor: tauri::State<'_, Mutex<NetworkMonitor>>,
) -> Result<serde_json::Value, String> {
    let monitor = monitor
        .lock()
        .map_err(|e| format!("Failed to acquire monitor lock: {e}"))?;
    let interface = interface.and_then(|name| {
        let name = name.trim().to_string();
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    });
    if monitor.selected_interface() != interface {
        monitor.set_interface(interface);
    }
    let stats = monitor.get_stats();
    serde_json::to_value(stats).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn get_default_interface() -> Result<serde_json::Value, String> {
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
