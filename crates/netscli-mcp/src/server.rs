use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};

use ipnet::Ipv4Net;
use serde_json::json;
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug)]
struct JsonRpcRequest {
    jsonrpc: String,
    method: String,
    params: Option<serde_json::Value>,
    id: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug)]
struct JsonRpcResponse {
    jsonrpc: String,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
    id: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug)]
struct JsonRpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Error)]
enum RpcError {
    #[error("Invalid Request: {0}")]
    InvalidRequest(String),
    #[error("Not initialized")]
    NotInitialized,
    #[error("Method not found")]
    MethodNotFound,
    #[error("Invalid params: {0}")]
    InvalidParams(String),
    #[error("{0}")]
    ToolError(String),
    #[error("{0}")]
    Internal(String),
}

impl RpcError {
    fn code(&self) -> i32 {
        match self {
            RpcError::InvalidRequest(_) => -32600,
            RpcError::NotInitialized => -32002,
            RpcError::MethodNotFound => -32601,
            RpcError::InvalidParams(_) => -32602,
            RpcError::ToolError(_) => -32000,
            RpcError::Internal(_) => -32603,
        }
    }
}

#[derive(Debug, Default)]
struct ServerState {
    initialized: bool,
}

fn clamp_concurrency(max_concurrent: Option<usize>, default: usize) -> usize {
    let c = max_concurrent.unwrap_or(default);
    c.clamp(1, 4096)
}

fn clamp_timeout_ms(timeout_ms: Option<u64>, default: u64) -> u64 {
    // Enforce a sane lower/upper bound to prevent hangs or instant timeouts.
    let t = timeout_ms.unwrap_or(default);
    t.clamp(10, 10 * 60 * 1000)
}

fn parse_params<T: DeserializeOwned>(val: Value) -> Result<T, RpcError> {
    serde_json::from_value(val).map_err(|e| RpcError::InvalidParams(e.to_string()))
}

const MAX_SUBNET_ADDRESSES: u64 = 1 << 16; // /16
const MAX_PORTS_PER_REQUEST: usize = 4096;

fn validate_subnet(subnet: &str) -> Result<(), RpcError> {
    let net: Ipv4Net = subnet
        .parse()
        .map_err(|e| RpcError::InvalidParams(format!("invalid subnet '{subnet}': {e}")))?;
    let prefix = net.prefix_len() as u32;
    let total = 1u64
        .checked_shl(32u32.saturating_sub(prefix))
        .unwrap_or(u64::MAX);
    if total > MAX_SUBNET_ADDRESSES {
        return Err(RpcError::InvalidParams(format!(
            "subnet too large: {subnet} (max /16)"
        )));
    }
    Ok(())
}

fn normalize_ports(mut ports: Option<Vec<u16>>) -> Result<Option<Vec<u16>>, RpcError> {
    let Some(mut ps) = ports.take() else {
        return Ok(None);
    };
    if ps.is_empty() {
        return Ok(None);
    }
    if ps.len() > MAX_PORTS_PER_REQUEST {
        return Err(RpcError::InvalidParams(format!(
            "too many ports requested ({} > {})",
            ps.len(),
            MAX_PORTS_PER_REQUEST
        )));
    }
    if ps.contains(&0) {
        return Err(RpcError::InvalidParams("port 0 is invalid".to_string()));
    }
    ps.sort_unstable();
    ps.dedup();
    Ok(Some(ps))
}

#[derive(Deserialize)]
struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    protocol_version: Option<String>,
    #[allow(dead_code)]
    capabilities: Option<serde_json::Value>,
    #[allow(dead_code)]
    #[serde(rename = "clientInfo")]
    client_info: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct DiscoverParams {
    subnet: Option<String>,
    #[serde(rename = "resolveHostnames")]
    resolve_hostnames: Option<bool>,
    timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
struct PingHostParams {
    host: String,
    /// Number of ICMP/TCP probes to send. Defaults to 1 (single-shot); the
    /// CLI's `netscli ping` defaults to 4 but MCP clients typically want a
    /// single summary for a scripted workflow.
    #[serde(default)]
    count: Option<u32>,
    timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
struct ScanParams {
    host: String,
    ports: Option<Vec<u16>>,
    timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
struct DnsParams {
    host: String,
    #[serde(rename = "type")]
    record_type: Option<String>,
}

#[derive(Deserialize)]
struct SweepParams {
    subnet: Option<String>,
    ports: Option<Vec<u16>>,
    #[serde(rename = "resolveHostnames")]
    resolve_hostnames: Option<bool>,
    timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
#[cfg_attr(not(feature = "pcap"), allow(dead_code))]
struct PcapParams {
    interface: String,
    filter: Option<String>,
    duration: Option<u64>,
    #[serde(rename = "outputFile")]
    output_file: Option<String>,
    #[serde(rename = "maxPackets")]
    max_packets: Option<u64>,
}

/// Initialize a tracing subscriber that writes JSON to stderr.
///
/// Uses `RUST_LOG` if set, otherwise defaults to `info`. Uses `try_init`
/// so it's a no-op when the caller already installed a subscriber (e.g.
/// a host binary that wants its own format).
///
/// **Why stderr, not stdout?** stdout is the JSON-RPC transport — any
/// byte written there that isn't a valid response will break the client.
fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(filter)
        .with_target(false)
        .json()
        .with_current_span(false)
        .with_span_list(false)
        .try_init();
}

pub async fn run_server() -> anyhow::Result<()> {
    init_tracing();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        pcap = cfg!(feature = "pcap"),
        "netscli MCP server starting"
    );

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin).lines();
    let mut writer = BufWriter::new(stdout);
    let mut state = ServerState::default();
    let mut requests_handled: u64 = 0;

    while let Some(line) = reader.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(req) => req,
            Err(e) => {
                tracing::warn!(error = %e, "json parse error");
                // Parse error. JSON-RPC expects id=null.
                let response = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32700,
                        message: "Parse error".to_string(),
                    }),
                    id: Some(serde_json::Value::Null),
                };
                let response_str = serde_json::to_string(&response)?;
                writer.write_all(response_str.as_bytes()).await?;
                writer.write_all(b"\n").await?;
                writer.flush().await?;
                continue;
            }
        };

        // Notifications (no id) must not get a response.
        if request.id.is_none() {
            tracing::debug!(method = %request.method, "notification");
            if request.method == "notifications/initialized" {
                state.initialized = true;
            }
            continue;
        }

        let response = handle_request(&mut state, request).await;
        let response_str = serde_json::to_string(&response)?;
        writer.write_all(response_str.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
        requests_handled += 1;
    }

    tracing::info!(requests_handled, "netscli MCP server shutting down");
    Ok(())
}

async fn handle_request(state: &mut ServerState, req: JsonRpcRequest) -> JsonRpcResponse {
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

pub fn tools_list() -> serde_json::Value {
    let tools = vec![
        json!({
            "name": "discover_network",
            "description": "Discover live hosts on a network subnet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": { "type": "string", "default": "192.168.1.0/24" },
                    "resolveHostnames": { "type": "boolean", "default": false },
                    "timeout": { "type": "number", "default": 1000 },
                    "maxConcurrent": { "type": "number", "default": 256 }
                }
            }
        }),
        json!({
            "name": "scan_ports",
            "description": "Scan TCP ports on a host",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "ports": { "type": "array", "items": { "type": "number" } },
                    "timeout": { "type": "number", "default": 500 },
                    "maxConcurrent": { "type": "number", "default": 256 }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "ping_host",
            "description": "Ping a host (ICMP with TCP-connect fallback). Returns a PingSummary with aggregate loss and min/avg/max RTT when count > 1.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "count": { "type": "number", "default": 1, "minimum": 1, "maximum": 256 },
                    "timeout": { "type": "number", "default": 1000 },
                    "maxConcurrent": { "type": "number", "default": 64 }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "dns_lookup",
            "description": "DNS lookup (A, AAAA, CNAME, MX, NS, TXT, SRV, PTR, SOA, CAA, or ALL/ANY for every record type)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "type": {
                        "type": "string",
                        "default": "A",
                        "enum": ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SRV", "PTR", "SOA", "CAA", "ALL", "ANY"]
                    }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "get_arp_table",
            "description": "Get ARP/neighbor table with vendor information",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "inspect_host",
            "description": "Inspect a host (ping + port scan + optional DNS resolution)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "ports": { "type": "array", "items": { "type": "number" } }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "sweep_network",
            "description": "Sweep a network (discover hosts then scan ports)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": { "type": "string", "default": "192.168.1.0/24" },
                    "ports": { "type": "array", "items": { "type": "number" } },
                    "resolveHostnames": { "type": "boolean", "default": false },
                    "timeout": { "type": "number", "default": 500 },
                    "maxConcurrent": { "type": "number", "default": 256 }
                }
            }
        }),
        json!({
            "name": "list_network_interfaces",
            "description": "List network interfaces with details",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
    ];

    #[cfg(feature = "pcap")]
    let tools = {
        let mut tools = tools;
        tools.push(json!({
            "name": "capture_pcap",
            "description": "Capture network packets to a PCAP file (may require root/admin)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "interface": { "type": "string" },
                    "filter": { "type": "string" },
                    "duration": { "type": "number", "default": 10 },
                    "outputFile": { "type": "string", "default": "capture.pcap" },
                    "maxPackets": { "type": "number" }
                },
                "required": ["interface"]
            }
        }));
        tools
    };

    json!({ "tools": tools })
}

fn mcp_tool_result_text(val: serde_json::Value) -> serde_json::Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&val).unwrap_or_else(|_| "<serialization error>".to_string())
            }
        ]
    })
}

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).

async fn op_discover(p: DiscoverParams) -> Result<Vec<netscli_core::Host>, RpcError> {
    if let Some(ref subnet) = p.subnet {
        validate_subnet(subnet)?;
    }
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_PING_TIMEOUT_MS);
    let cfg = netscli_core::OpsConfig {
        concurrency,
        ping_timeout_ms: timeout_ms,
        dns_timeout_ms: timeout_ms,
        ..Default::default()
    };
    let ops = netscli_core::Ops::new(cfg);
    let (_subnet, hosts) = ops
        .discover_ipv4(p.subnet, p.resolve_hostnames.unwrap_or(false))
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    Ok(hosts)
}

async fn op_scan_ports(p: ScanParams) -> Result<Vec<netscli_core::PortResult>, RpcError> {
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_SCAN_TIMEOUT_MS);
    let cfg = netscli_core::OpsConfig {
        concurrency,
        scan_timeout_ms: timeout_ms,
        ..Default::default()
    };
    let ops = netscli_core::Ops::new(cfg);
    let (_ip, res) = ops
        .scan_ports(&p.host, ports)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    Ok(res)
}

async fn op_inspect_host(p: ScanParams) -> Result<netscli_core::InspectResult, RpcError> {
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_SCAN_TIMEOUT_MS);
    let cfg = netscli_core::OpsConfig {
        concurrency,
        scan_timeout_ms: timeout_ms,
        ping_timeout_ms: timeout_ms,
        dns_timeout_ms: timeout_ms,
    };
    let ops = netscli_core::Ops::new(cfg);
    ops.inspect_host(p.host, ports)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

async fn op_sweep(p: SweepParams) -> Result<Vec<netscli_core::SweepEntry>, RpcError> {
    if let Some(ref subnet) = p.subnet {
        validate_subnet(subnet)?;
    }
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_SCAN_TIMEOUT_MS);
    let cfg = netscli_core::OpsConfig {
        concurrency,
        scan_timeout_ms: timeout_ms,
        ping_timeout_ms: timeout_ms,
        dns_timeout_ms: timeout_ms,
    };
    let ops = netscli_core::Ops::new(cfg);
    let (_subnet, res) = ops
        .sweep_ipv4(p.subnet, ports, p.resolve_hostnames.unwrap_or(false))
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    Ok(res)
}

async fn op_ping_host(p: PingHostParams) -> Result<netscli_core::PingSummary, RpcError> {
    if p.host.trim().is_empty() {
        return Err(RpcError::InvalidParams("host is required".to_string()));
    }
    let _ = p.max_concurrent; // retained for forward-compat with older clients
    let count = p.count.unwrap_or(1).clamp(1, 256);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_PING_TIMEOUT_MS);

    // Use the Ops facade so the summary (loss %, min/avg/max RTT) matches
    // what `netscli ping` emits from the CLI.
    let cfg = netscli_core::OpsConfig {
        ping_timeout_ms: timeout_ms,
        dns_timeout_ms: timeout_ms,
        ..Default::default()
    };
    let ops = netscli_core::Ops::new(cfg);
    ops.ping_host_summary(&p.host, count)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

async fn op_dns_lookup(p: DnsParams) -> Result<Vec<netscli_core::dns::DnsRecord>, RpcError> {
    if let Some(ref t) = p.record_type {
        let upper = t.to_uppercase();
        if upper != "ALL"
            && upper != "ANY"
            && netscli_core::dns::parse_record_type(&upper).is_none()
        {
            return Err(RpcError::InvalidParams(format!(
                "unsupported record type: {t}"
            )));
        }
    }
    let ops = netscli_core::Ops::default();
    ops.dns_lookup(&p.host, p.record_type)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

fn op_get_arp_table() -> Result<Vec<netscli_core::ArpEntry>, RpcError> {
    let ops = netscli_core::Ops::default();
    ops.get_arp_table()
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

fn op_list_interfaces() -> Vec<netscli_core::InterfaceInfo> {
    let ops = netscli_core::Ops::default();
    ops.list_interfaces()
}

#[cfg(feature = "pcap")]
async fn op_capture_pcap(p: PcapParams) -> Result<netscli_core::PcapResult, RpcError> {
    if p.interface.trim().is_empty() {
        return Err(RpcError::InvalidParams("interface is required".to_string()));
    }
    let duration = p.duration.map(|s| s.clamp(1, 60 * 60));
    let max_packets = match p.max_packets {
        Some(0) => None,
        Some(n) => {
            if n > (usize::MAX as u64) {
                return Err(RpcError::InvalidParams("maxPackets too large".to_string()));
            }
            Some(n as usize)
        }
        None => None,
    };
    let ops = netscli_core::Ops::default();
    ops.capture_pcap_async(p.interface, p.filter, duration, p.output_file, max_packets)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

#[cfg(not(feature = "pcap"))]
async fn op_capture_pcap(_p: PcapParams) -> Result<netscli_core::PcapResult, RpcError> {
    Err(RpcError::ToolError(
        "pcap support disabled at compile time".to_string(),
    ))
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
        "tools/call" => {
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
                    let open: Vec<_> = res.into_iter().filter(|r| r.open).collect();
                    json!(open)
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
                other => {
                    return Err(RpcError::InvalidParams(format!("Unknown tool: {other}")));
                }
            };

            Ok(mcp_tool_result_text(output))
        }

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
        _ => Err(RpcError::MethodNotFound),
    }
}
