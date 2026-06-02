use serde::Deserialize;
use serde_json::{json, Value};

use super::errors::RpcError;
use super::operations::{
    op_capture_pcap, op_discover, op_dns_lookup, op_get_arp_table, op_inspect_host,
    op_list_interfaces, op_ping_host, op_scan_ports, op_sweep,
};
use super::protocol::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
use super::schemas::{
    parse_params, DiscoverParams, DnsParams, InitializeParams, PcapParams, PingHostParams,
    ScanParams, SweepParams,
};
use super::tools::{mcp_tool_result_text, tools_list};

#[cfg(feature = "mdns")]
use super::operations::op_discover_mdns;
#[cfg(feature = "mdns")]
use super::schemas::MdnsParams;

#[derive(Debug, Default)]
pub(super) struct ServerState {
    pub(super) initialized: bool,
}

pub(super) async fn handle_request(
    state: &mut ServerState,
    req: JsonRpcRequest,
) -> JsonRpcResponse {
    let id = req.id.clone();
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

    match handle_request_inner(state, &req).await {
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
    state: &mut ServerState,
    req: &JsonRpcRequest,
) -> Result<serde_json::Value, RpcError> {
    if req.jsonrpc != "2.0" {
        return Err(RpcError::InvalidRequest(format!(
            "expected jsonrpc='2.0', got '{}'",
            req.jsonrpc
        )));
    }

    // Enforce MCP init lifecycle for requests.
    if !state.initialized && req.method != "initialize" && req.method != "tools/list" {
        return Err(RpcError::NotInitialized);
    }

    let params = req.params.clone().unwrap_or(Value::Null);

    match req.method.as_str() {
        // MCP lifecycle
        "initialize" => {
            let p: InitializeParams = parse_params(params)?;
            let protocol = p
                .protocol_version
                .unwrap_or_else(|| "2024-11-05".to_string());
            state.initialized = true;
            Ok(json!({
                "protocolVersion": protocol,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "netscli", "version": env!("CARGO_PKG_VERSION") }
            }))
        }
        "tools/list" => Ok(tools_list()),
        "tools/call" => handle_tools_call(params).await,

        // Backwards-compatible direct JSON-RPC methods
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
        "get_arp_table" => {
            serde_json::to_value(op_get_arp_table()?).map_err(|e| RpcError::Internal(e.to_string()))
        }
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

async fn handle_tools_call(params: Value) -> Result<serde_json::Value, RpcError> {
    #[derive(Deserialize)]
    struct ToolCallParams {
        name: String,
        #[serde(default, rename = "arguments")]
        args: serde_json::Value,
    }

    let p: ToolCallParams = parse_params(params)?;
    let args = if p.args.is_null() {
        Value::Object(serde_json::Map::new())
    } else {
        p.args
    };

    let output = match p.name.as_str() {
        "discover_network" => {
            let p: DiscoverParams = parse_params(args)?;
            let hosts = op_discover(p).await?;
            json!(hosts)
        }
        "scan_ports" => {
            let p: ScanParams = parse_params(args)?;
            let res = op_scan_ports(p).await?;
            json!(res)
        }
        "ping_host" => {
            let p: PingHostParams = parse_params(args)?;
            let res = op_ping_host(p).await?;
            json!(res)
        }
        "dns_lookup" => {
            let p: DnsParams = parse_params(args)?;
            let res = op_dns_lookup(p).await?;
            json!(res)
        }
        "get_arp_table" => {
            json!(op_get_arp_table()?)
        }
        "inspect_host" => {
            let p: ScanParams = parse_params(args)?;
            let res = op_inspect_host(p).await?;
            json!(res)
        }
        "sweep_network" => {
            let p: SweepParams = parse_params(args)?;
            let res = op_sweep(p).await?;
            json!(res)
        }
        "list_network_interfaces" => {
            json!(op_list_interfaces())
        }
        "capture_pcap" => {
            let p: PcapParams = parse_params(args)?;
            let res = op_capture_pcap(p).await?;
            json!(res)
        }
        #[cfg(feature = "mdns")]
        "discover_mdns" => {
            let p: MdnsParams = parse_params(args)?;
            let res = op_discover_mdns(p).await?;
            json!(res)
        }
        other => {
            return Err(RpcError::InvalidParams(format!("Unknown tool: {other}")));
        }
    };

    Ok(mcp_tool_result_text(output))
}
