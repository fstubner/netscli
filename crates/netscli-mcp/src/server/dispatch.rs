use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::errors::RpcError;
#[cfg(feature = "pcap")]
use super::jobs::{pcap_job_result, pcap_job_status, start_pcap_capture_job, PcapJobMap};
use super::operations::{
    op_capture_pcap, op_discover, op_dns_lookup, op_get_arp_table, op_inspect_host,
    op_list_interfaces, op_ping_host, op_scan_ports, op_sweep,
};
use super::protocol::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
use super::schemas::{
    parse_params, DiscoverParams, DnsParams, InitializeParams, PcapParams, PingHostParams,
    ScanParams, SweepParams,
};
use super::tools::tools_list;

#[cfg(feature = "mdns")]
use super::operations::op_discover_mdns;
#[cfg(feature = "mdns")]
use super::schemas::MdnsParams;

#[derive(Debug, Default)]
pub(super) struct ServerState {
    pub(super) initialized: bool,
    #[cfg(feature = "pcap")]
    pub(super) pcap_jobs: PcapJobMap,
    #[cfg(feature = "pcap")]
    pub(super) next_pcap_job_id: u64,
}

/// Shared server state.
///
/// A `std::sync::Mutex` is deliberate: every critical section below is
/// synchronous and short (a bool read, a job-map insert). Nothing holds this
/// guard across an `.await`, which is what keeps the handler futures `Send`
/// and keeps slow tool calls — the whole reason this is concurrent — outside
/// the lock entirely.
pub(super) type SharedState = Arc<Mutex<ServerState>>;

fn lock(state: &SharedState) -> Result<std::sync::MutexGuard<'_, ServerState>, RpcError> {
    state
        .lock()
        .map_err(|_| RpcError::Internal("server state lock poisoned".to_string()))
}

pub(super) async fn handle_request(state: SharedState, req: JsonRpcRequest) -> JsonRpcResponse {
    let id = req.id.clone().flatten();
    let method = req.method.clone();
    // For tools/call the caller-visible operation is the tool name; surface it
    // so log consumers can grep a single tool without regex-parsing params.
    let tool_name: Option<String> = if method == "tools/call" {
        req.params
            .as_ref()
            .and_then(|p| p.get("name"))
            .and_then(|n| n.as_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    let start = std::time::Instant::now();
    let mut response = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: None,
        error: None,
        id,
    };

    match handle_request_inner(&state, &req).await {
        Ok(val) => {
            response.result = Some(val);
        }
        Err(e) => {
            response.error = Some(JsonRpcError {
                code: e.code(),
                message: e.to_string(),
            });
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    match response.error.as_ref() {
        None => tracing::info!(
            method = %method,
            tool = tool_name.as_deref(),
            duration_ms,
            "ok"
        ),
        Some(err) => tracing::warn!(
            method = %method,
            tool = tool_name.as_deref(),
            duration_ms,
            code = err.code,
            message = %err.message,
            "error"
        ),
    }

    response
}

async fn handle_request_inner(
    state: &SharedState,
    req: &JsonRpcRequest,
) -> Result<serde_json::Value, RpcError> {
    if req.jsonrpc != "2.0" {
        return Err(RpcError::InvalidRequest(format!(
            "expected jsonrpc='2.0', got '{}'",
            req.jsonrpc
        )));
    }

    // Enforce MCP init lifecycle for requests. Read and release — the guard
    // must not survive into the tool dispatch below.
    if !lock(state)?.initialized && req.method != "initialize" && req.method != "tools/list" {
        return Err(RpcError::NotInitialized);
    }

    // Absent params become an empty object, not null. `tools/call` already
    // did this for its `arguments`, so `{"method":"discover_network","id":1}`
    // failed with -32602 while the identical call through `tools/call`
    // succeeded -- every field on these param structs is optional.
    let params = match req.params.clone() {
        None | Some(Value::Null) => Value::Object(serde_json::Map::new()),
        Some(value) => value,
    };

    match req.method.as_str() {
        // MCP lifecycle
        "initialize" => {
            let p: InitializeParams = parse_params(params)?;
            let protocol = p
                .protocol_version
                .unwrap_or_else(|| "2024-11-05".to_string());
            lock(state)?.initialized = true;
            Ok(json!({
                "protocolVersion": protocol,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "netscli", "version": env!("CARGO_PKG_VERSION") }
            }))
        }
        "tools/list" => Ok(tools_list()),
        "tools/call" => handle_tools_call(state, params).await,

        // Backwards-compatible direct JSON-RPC methods for the pcap job
        // lifecycle. These are stateful (server-held job handles, in
        // `jobs.rs`), so they stay separate from `dispatch_tool`'s
        // stateless tool table below.
        // The guard is bound to a local rather than inlined as
        // `&mut lock(state)?`: a guard built inside the argument list is a
        // temporary, and the reborrow through it does not coerce to
        // `&mut ServerState` there.
        #[cfg(feature = "pcap")]
        "start_pcap_capture" => {
            let mut guard = lock(state)?;
            start_pcap_capture_job(&mut guard, params)
        }
        #[cfg(feature = "pcap")]
        "get_pcap_capture_status" => {
            let guard = lock(state)?;
            pcap_job_status(&guard, params)
        }
        #[cfg(feature = "pcap")]
        "get_pcap_capture_result" => {
            let guard = lock(state)?;
            pcap_job_result(&guard, params)
        }

        // Every other backwards-compatible direct method name maps 1:1 onto
        // a `tools/call` tool of the same name; share that table instead of
        // duplicating each arm here and in `handle_tools_call`.
        other => dispatch_tool(other, params).await,
    }
}

/// Stateless tool dispatch shared by the legacy direct JSON-RPC methods and
/// `tools/call`. Returns the tool's raw result value — callers decide how to
/// shape it (legacy methods return it as-is; `tools/call` wraps it via
/// `mcp_tool_result_text`).
async fn dispatch_tool(name: &str, params: Value) -> Result<Value, RpcError> {
    let mut result = dispatch_tool_inner(name, params).await?;
    // One choke point for both callers. Applying this per-arm would mean
    // every tool added later had to remember, and the tool most likely to
    // carry remote bytes is whichever one is written next.
    super::limits::cap_remote_text(&mut result);
    Ok(super::limits::cap_result_size(result))
}

async fn dispatch_tool_inner(name: &str, params: Value) -> Result<Value, RpcError> {
    match name {
        "discover_network" => {
            let p: DiscoverParams = parse_params(params)?;
            let hosts = op_discover(p).await?;
            serde_json::to_value(hosts).map_err(|e| RpcError::Internal(e.to_string()))
        }
        "scan_ports" => {
            let p: ScanParams = parse_params(params)?;
            let res = op_scan_ports(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        "ping_host" => {
            let p: PingHostParams = parse_params(params)?;
            let res = op_ping_host(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        "dns_lookup" => {
            let p: DnsParams = parse_params(params)?;
            let res = op_dns_lookup(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        "get_arp_table" => serde_json::to_value(op_get_arp_table().await?)
            .map_err(|e| RpcError::Internal(e.to_string())),
        "inspect_host" => {
            let p: ScanParams = parse_params(params)?;
            let res = op_inspect_host(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        "sweep_network" => {
            let p: SweepParams = parse_params(params)?;
            let res = op_sweep(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        "list_network_interfaces" => serde_json::to_value(op_list_interfaces())
            .map_err(|e| RpcError::Internal(e.to_string())),
        "capture_pcap" => {
            let p: PcapParams = parse_params(params)?;
            let res = op_capture_pcap(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        #[cfg(feature = "mdns")]
        "discover_mdns" => {
            let p: MdnsParams = parse_params(params)?;
            let res = op_discover_mdns(p).await?;
            serde_json::to_value(res).map_err(|e| RpcError::Internal(e.to_string()))
        }
        _ => Err(RpcError::MethodNotFound),
    }
}

mod tool_call;
use tool_call::handle_tools_call;

#[cfg(test)]
mod policy_tests;
#[cfg(test)]
mod tests;
