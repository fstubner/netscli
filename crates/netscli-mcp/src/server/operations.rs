use super::errors::RpcError;
use super::schemas::{
    clamp_concurrency, clamp_timeout_ms, normalize_ports, validate_subnet, DiscoverParams,
    DnsParams, PingHostParams, ScanParams, SweepParams,
};
use super::targets::ensure_host_allowed;

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).

mod pcap;

#[cfg(not(feature = "pcap"))]
pub(in crate::server) use pcap::op_capture_pcap;
#[cfg(feature = "pcap")]
pub(in crate::server) use pcap::{op_capture_pcap, run_pcap_capture, validate_pcap_capture_params};

/// Settle the subnet before anything is checked or scanned.
///
/// The default used to be substituted deep inside `Ops`, which meant the
/// no-subnet call skipped the target policy entirely -- safe in practice,
/// because the substituted value is the operator's own interface, but safe
/// by accident rather than by decision. Two things follow from resolving it
/// here instead: the policy applies to every path, and the subnet that gets
/// checked is the exact string that gets scanned rather than a second
/// derivation that could differ if an interface changed in between.
///
/// The visible consequence is that a machine whose LAN carries public
/// addresses -- some universities and ISPs still do this -- now gets a clear
/// refusal naming its own subnet, instead of silently scanning it. That is
/// the honest outcome: the operator opts in once and knows why.
fn resolved_subnet(requested: Option<String>) -> Result<String, RpcError> {
    resolve_and_check(requested, netscli_core::default_ipv4_subnet_string)
}

/// The body of `resolved_subnet`, with the default supplied by the caller.
///
/// Split solely so a test can pin the case that matters and cannot otherwise
/// be reached: a machine whose own interface carries public addresses. The
/// real default comes from whatever interface the test host happens to have,
/// so a test using it asserts nothing.
fn resolve_and_check(
    requested: Option<String>,
    default: impl FnOnce() -> String,
) -> Result<String, RpcError> {
    let subnet = requested.unwrap_or_else(default);
    validate_subnet(&subnet)?;
    Ok(subnet)
}

/// The settings for one operation: the client's concurrency, and its
/// `timeout` applied to every phase if it gave one.
///
/// Without a `timeout` each phase keeps the core default (ping 1,000 ms,
/// scan 500 ms, DNS 1,500 ms), the same as the CLI, TUI and desktop app.
/// Before, the tool's advertised default stood in for all of them, so an MCP
/// inspect or sweep pinged with 500 ms where the others used 1,000, and a
/// discover gave reverse DNS 1,000 ms where the others gave 1,500.
fn ops_config(concurrency: usize, timeout: Option<u64>) -> netscli_core::OpsConfig {
    let mut cfg = netscli_core::OpsConfig {
        concurrency,
        ..Default::default()
    };
    if timeout.is_some() {
        let ms = clamp_timeout_ms(timeout, 0);
        cfg.ping_timeout_ms = ms;
        cfg.scan_timeout_ms = ms;
        cfg.dns_timeout_ms = ms;
    }
    cfg
}

pub(super) async fn op_discover(p: DiscoverParams) -> Result<Vec<netscli_core::Host>, RpcError> {
    let subnet = resolved_subnet(p.subnet)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let cfg = ops_config(concurrency, p.timeout);
    let ops = netscli_core::Ops::new(cfg);
    let (_subnet, hosts) = ops
        .discover_ipv4(Some(subnet), p.resolve_hostnames.unwrap_or(false))
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    Ok(hosts)
}

pub(super) async fn op_scan_ports(
    p: ScanParams,
) -> Result<Vec<netscli_core::PortResult>, RpcError> {
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let cfg = ops_config(concurrency, p.timeout);
    // Scan the address that was checked, not the name that produced it --
    // see `ensure_host_allowed` for why the two can differ.
    let ip = ensure_host_allowed(&p.host, netscli_core::DEFAULT_DNS_TIMEOUT_MS).await?;
    let ops = netscli_core::Ops::new(cfg);
    let scan = if p.udp.unwrap_or(false) {
        ops.scan_udp_ports(&ip.to_string(), ports).await
    } else {
        ops.scan_ports(&ip.to_string(), ports).await
    };
    let (_ip, mut res) = scan.map_err(|e| RpcError::ToolError(e.to_string()))?;
    if !p.include_closed.unwrap_or(false) {
        drop_unanswered_ports(&mut res);
    }
    Ok(res)
}

/// Keep the ports worth a model's attention: open, `open|filtered`, and any
/// that errored. Closed and filtered ports are what most of a scan is, and
/// they arrived one object each. A 1,024-port scan of a LAN machine with two
/// open ports was 136,834 bytes (measured 2026-10-03), nearly all of it
/// saying "closed". `include_closed: true` returns every port.
fn drop_unanswered_ports(ports: &mut Vec<netscli_core::PortResult>) {
    ports.retain(|p| worth_reporting(p.status));
}

fn worth_reporting(status: netscli_core::PortStatus) -> bool {
    use netscli_core::PortStatus;
    !matches!(status, PortStatus::Closed | PortStatus::Filtered)
}

pub(super) async fn op_inspect_host(
    p: ScanParams,
) -> Result<netscli_core::InspectResult, RpcError> {
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let cfg = ops_config(concurrency, p.timeout);
    let ops = netscli_core::Ops::new(cfg);
    let ip = ensure_host_allowed(&p.host, netscli_core::DEFAULT_DNS_TIMEOUT_MS).await?;
    let mut result = ops
        .inspect_host(ip.to_string(), ports)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    // `host` is documented as the original target, so give the caller back
    // what it asked for. The address above is what was probed.
    result.host = p.host.trim().to_string();
    if !p.include_closed.unwrap_or(false) {
        drop_unanswered_ports(&mut result.ports);
    }
    Ok(result)
}

pub(super) async fn op_sweep(p: SweepParams) -> Result<Vec<netscli_core::SweepEntry>, RpcError> {
    let subnet = resolved_subnet(p.subnet)?;
    let ports = normalize_ports(p.ports)?;
    let concurrency = clamp_concurrency(p.max_concurrent, netscli_core::DEFAULT_CONCURRENCY);
    let cfg = ops_config(concurrency, p.timeout);
    let ops = netscli_core::Ops::new(cfg);
    let (_subnet, res) = ops
        .sweep_ipv4(Some(subnet), ports, p.resolve_hostnames.unwrap_or(false))
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
    let count = p.count.unwrap_or(1).clamp(1, netscli_core::MAX_PING_COUNT);

    // Use the Ops facade so the summary (loss %, min/avg/max RTT) matches
    // what `netscli ping` emits from the CLI.
    let cfg = ops_config(netscli_core::DEFAULT_CONCURRENCY, p.timeout);
    let ip = ensure_host_allowed(&p.host, cfg.dns_timeout_ms).await?;
    let ops = netscli_core::Ops::new(cfg);
    let mut summary = ops
        .ping_host_summary(&ip.to_string(), count)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    // Same as inspect: probe the checked address, report the asked-for name.
    summary.host = p.host.trim().to_string();
    Ok(summary)
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

#[cfg(feature = "mdns")]
pub(super) async fn op_discover_mdns(
    p: super::schemas::MdnsParams,
) -> Result<Vec<netscli_core::MdnsService>, RpcError> {
    // Clamp timeout: no point waiting more than 30s for an interactive-like
    // tool call, and 0/None means use the 3s default.
    let timeout_ms = p
        .timeout_ms
        .unwrap_or(3000)
        .clamp(100, netscli_core::MAX_MDNS_TIMEOUT_MS);
    let service_types = p.service_types.unwrap_or_default();
    let ops = netscli_core::Ops::default();
    ops.discover_mdns(&service_types, std::time::Duration::from_millis(timeout_ms))
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_and_filtered_ports_are_dropped_and_the_rest_kept() {
        use netscli_core::PortStatus;
        assert!(worth_reporting(PortStatus::Open));
        assert!(worth_reporting(PortStatus::OpenFiltered));
        assert!(worth_reporting(PortStatus::Error));
        assert!(!worth_reporting(PortStatus::Closed));
        assert!(!worth_reporting(PortStatus::Filtered));
    }

    #[test]
    fn without_a_timeout_each_phase_keeps_the_core_default() {
        let cfg = ops_config(64, None);
        assert_eq!(cfg.concurrency, 64);
        assert_eq!(cfg.ping_timeout_ms, netscli_core::DEFAULT_PING_TIMEOUT_MS);
        assert_eq!(cfg.scan_timeout_ms, netscli_core::DEFAULT_SCAN_TIMEOUT_MS);
        assert_eq!(cfg.dns_timeout_ms, netscli_core::DEFAULT_DNS_TIMEOUT_MS);
    }

    #[test]
    fn a_timeout_from_the_client_applies_to_every_phase_within_bounds() {
        let cfg = ops_config(64, Some(2_000));
        assert_eq!(
            (cfg.ping_timeout_ms, cfg.scan_timeout_ms, cfg.dns_timeout_ms),
            (2_000, 2_000, 2_000)
        );
        assert_eq!(ops_config(64, Some(1)).scan_timeout_ms, 10);
    }

    #[test]
    fn a_publicly_addressed_interface_is_refused_rather_than_scanned() {
        // The case this whole change exists for. Before, the default was
        // substituted inside `Ops` after every check had run, so a host whose
        // LAN is publicly addressed -- some universities and ISPs still do
        // this -- had its own subnet scanned with no policy consulted.
        let err = resolve_and_check(None, || "203.0.113.0/24".to_string())
            .expect_err("a public default must be refused, not silently scanned");
        let message = err.to_string();
        assert!(message.contains("203.0.113.0/24"), "got: {message}");
        assert!(
            message.contains("NETSCLI_MCP_ALLOW_PUBLIC_TARGETS"),
            "got: {message}"
        );
    }

    #[test]
    fn an_ordinary_private_default_is_returned_unchanged() {
        let subnet = resolve_and_check(None, || "192.168.1.0/24".to_string())
            .expect("a private default must pass");
        assert_eq!(subnet, "192.168.1.0/24");
    }

    #[test]
    fn an_explicit_subnet_wins_over_the_default() {
        // The default must not be consulted at all when one was supplied,
        // or a bad default could override a good request.
        let subnet = resolve_and_check(Some("10.1.2.0/24".to_string()), || {
            panic!("the default must not be evaluated when a subnet was given")
        })
        .expect("an explicit private subnet must pass");
        assert_eq!(subnet, "10.1.2.0/24");
    }
}
