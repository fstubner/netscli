use super::errors::RpcError;
use super::schemas::{
    clamp_concurrency, clamp_timeout_ms, normalize_ports, validate_subnet, DiscoverParams,
    DnsParams, PcapParams, PingHostParams, ScanParams, SweepParams,
};
use super::targets::ensure_host_allowed;

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).

pub(super) async fn op_discover(p: DiscoverParams) -> Result<Vec<netscli_core::Host>, RpcError> {
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

pub(super) async fn op_scan_ports(
    p: ScanParams,
) -> Result<Vec<netscli_core::PortResult>, RpcError> {
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_SCAN_TIMEOUT_MS);
    let cfg = netscli_core::OpsConfig {
        concurrency,
        scan_timeout_ms: timeout_ms,
        ..Default::default()
    };
    ensure_host_allowed(&p.host, netscli_core::DEFAULT_DNS_TIMEOUT_MS).await?;
    let ops = netscli_core::Ops::new(cfg);
    let (_ip, res) = ops
        .scan_ports(&p.host, ports)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    Ok(res)
}

pub(super) async fn op_inspect_host(
    p: ScanParams,
) -> Result<netscli_core::InspectResult, RpcError> {
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
    ensure_host_allowed(&p.host, netscli_core::DEFAULT_DNS_TIMEOUT_MS).await?;
    ops.inspect_host(p.host, ports)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

pub(super) async fn op_sweep(p: SweepParams) -> Result<Vec<netscli_core::SweepEntry>, RpcError> {
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

pub(super) async fn op_ping_host(p: PingHostParams) -> Result<netscli_core::PingSummary, RpcError> {
    if p.host.trim().is_empty() {
        return Err(RpcError::InvalidParams("host is required".to_string()));
    }
    // Accepted from older clients but genuinely unused: the ping loop is
    // sequential. It is no longer advertised in the tool schema, which was
    // telling callers about a knob that did nothing.
    let _ = p.max_concurrent;
    let count = p.count.unwrap_or(1).clamp(1, 256);
    let timeout_ms = clamp_timeout_ms(p.timeout, netscli_core::DEFAULT_PING_TIMEOUT_MS);

    // Use the Ops facade so the summary (loss %, min/avg/max RTT) matches
    // what `netscli ping` emits from the CLI.
    let cfg = netscli_core::OpsConfig {
        ping_timeout_ms: timeout_ms,
        dns_timeout_ms: timeout_ms,
        ..Default::default()
    };
    ensure_host_allowed(&p.host, timeout_ms).await?;
    let ops = netscli_core::Ops::new(cfg);
    ops.ping_host_summary(&p.host, count)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

pub(super) async fn op_dns_lookup(
    p: DnsParams,
) -> Result<Vec<netscli_core::dns::DnsRecord>, RpcError> {
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

pub(super) async fn op_get_arp_table() -> Result<Vec<netscli_core::ArpEntry>, RpcError> {
    let ops = netscli_core::Ops::default();
    ops.get_arp_table()
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

pub(super) fn op_list_interfaces() -> Vec<netscli_core::InterfaceInfo> {
    let ops = netscli_core::Ops::default();
    ops.list_interfaces()
}

#[cfg(feature = "pcap")]
#[derive(Debug)]
pub(super) struct PcapCaptureRequest {
    interface: String,
    filter: Option<String>,
    duration: Option<u64>,
    output_file: Option<String>,
    max_packets: Option<usize>,
}

#[cfg(feature = "pcap")]
impl PcapCaptureRequest {
    pub(super) fn ensure_default_output_file(&mut self, output_file: String) {
        if self.output_file.is_none() {
            self.output_file = Some(output_file);
        }
    }
}

/// Longest a *blocking* `capture_pcap` call may run.
///
/// Core allows an hour, which is right for a capture written to a file and
/// collected later -- that is what `start_pcap_capture` is for. A synchronous
/// tool call is a different shape: it occupies a request slot for its whole
/// duration, and no client is usefully blocked for an hour.
#[cfg(feature = "pcap")]
const MAX_INTERACTIVE_CAPTURE_SECONDS: u64 = 120;

#[cfg(feature = "pcap")]
pub(super) fn validate_pcap_capture_params(p: PcapParams) -> Result<PcapCaptureRequest, RpcError> {
    if p.interface.trim().is_empty() {
        return Err(RpcError::InvalidParams("interface is required".to_string()));
    }
    // Clamped here as well as in core: an interactive tool call holding a
    // request permit for an hour is a different problem from a capture file
    // being too long, and the job API exists for the long case.
    let duration = p
        .duration
        .map(|seconds| seconds.min(MAX_INTERACTIVE_CAPTURE_SECONDS));
    let max_packets = match p.max_packets {
        Some(0) => {
            return Err(RpcError::InvalidParams(
                "maxPackets must be greater than 0".to_string(),
            ));
        }
        Some(n) => {
            if n > (usize::MAX as u64) {
                return Err(RpcError::InvalidParams("maxPackets too large".to_string()));
            }
            Some(n as usize)
        }
        None => None,
    };
    let output_file = p
        .output_file
        .map(validate_mcp_pcap_output_file)
        .transpose()?;
    Ok(PcapCaptureRequest {
        interface: p.interface,
        filter: p.filter,
        duration,
        output_file,
        max_packets,
    })
}

/// Concurrent captures, counted across both capture tools.
///
/// `MAX_RUNNING_PCAP_JOBS` only ever counted entries in the job map, which
/// `start_pcap_capture` populates and the blocking `capture_pcap` does not --
/// so the cap was bypassed by calling the other tool. The resource being
/// protected is the machine's capture capacity, which is a property of the
/// process rather than of one map, so the limit lives here where both paths
/// must pass through it.
#[cfg(feature = "pcap")]
static PCAP_CAPTURE_SLOTS: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(MAX_CONCURRENT_PCAP_CAPTURES);

#[cfg(feature = "pcap")]
pub(super) const MAX_CONCURRENT_PCAP_CAPTURES: usize = 4;

#[cfg(feature = "pcap")]
pub(super) async fn run_pcap_capture(
    request: PcapCaptureRequest,
) -> Result<netscli_core::PcapResult, RpcError> {
    // `try_acquire`, not `acquire`: waiting would hold one of the server's
    // request permits for however long the running captures take, which is
    // the wedge this limit exists to prevent. Refusing immediately tells the
    // client something actionable instead.
    let _slot = PCAP_CAPTURE_SLOTS.try_acquire().map_err(|_| {
        RpcError::ToolError(format!(
            "too many packet captures are already running (max {MAX_CONCURRENT_PCAP_CAPTURES})"
        ))
    })?;
    let ops = netscli_core::Ops::default();
    ops.capture_pcap_async(
        request.interface,
        request.filter,
        request.duration,
        request.output_file,
        request.max_packets,
    )
    .await
    .map_err(|e| RpcError::ToolError(e.to_string()))
}

#[cfg(feature = "pcap")]
pub(super) async fn op_capture_pcap(p: PcapParams) -> Result<netscli_core::PcapResult, RpcError> {
    let request = validate_pcap_capture_params(p)?;
    run_pcap_capture(request).await
}

#[cfg(feature = "pcap")]
fn validate_mcp_pcap_output_file(output_file: String) -> Result<String, RpcError> {
    let path = std::path::PathBuf::from(output_file.trim());
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| RpcError::InvalidParams("outputFile must include a filename".to_string()))?;
    if path.components().count() != 1 {
        return Err(RpcError::InvalidParams(
            "outputFile for MCP packet capture must be a filename, not a path".to_string(),
        ));
    }
    if !filename.to_ascii_lowercase().ends_with(".pcap") {
        return Err(RpcError::InvalidParams(
            "outputFile must end in .pcap".to_string(),
        ));
    }
    Ok(filename.to_string())
}

#[cfg(not(feature = "pcap"))]
pub(super) async fn op_capture_pcap(_p: PcapParams) -> Result<netscli_core::PcapResult, RpcError> {
    Err(RpcError::ToolError(
        "pcap support disabled at compile time".to_string(),
    ))
}

#[cfg(feature = "mdns")]
pub(super) async fn op_discover_mdns(
    p: super::schemas::MdnsParams,
) -> Result<Vec<netscli_core::MdnsService>, RpcError> {
    // Clamp timeout: no point waiting more than 30s for an interactive-like
    // tool call, and 0/None means use the 3s default.
    let timeout_ms = p.timeout_ms.unwrap_or(3000).clamp(100, 30_000);
    let service_types = p.service_types.unwrap_or_default();
    let ops = netscli_core::Ops::default();
    ops.discover_mdns(&service_types, std::time::Duration::from_millis(timeout_ms))
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}
