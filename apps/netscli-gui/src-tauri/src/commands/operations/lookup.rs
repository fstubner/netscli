use std::time::Duration;

use netscli_core::Ops;

use super::{run_json_operation, JsonResult};
use crate::state::OperationManager;

#[derive(Clone, serde::Serialize)]
struct ReverseDnsResult {
    ip: String,
    hostname: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct OptionalCapability {
    compiled: bool,
    available: bool,
    message: Option<String>,
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
        let entries = ops.get_arp_table().await.map_err(|e| e.to_string())?;
        serde_json::to_value(entries).map_err(|e| e.to_string())
    })
    .await
}
