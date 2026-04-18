use ipnet::Ipv4Net;
use serde::Serialize;
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::{
    default_ipv4_subnet_string, default_ports, ArpEntry, DiscoverEngine, Host, InspectEngine,
    InspectResult, InterfaceInfo, NetworkManager, PcapCancelToken, PcapConfig, PcapEngine,
    PcapResult, PingScanner, PortResult, PortScanner, SweepEngine, SweepEntry, DEFAULT_CONCURRENCY,
    DEFAULT_DNS_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS, DEFAULT_SCAN_TIMEOUT_MS,
};

const MAX_SUBNET_ADDRESSES: u64 = 1 << 16; // /16

fn ensure_subnet_limit(net: &Ipv4Net, subnet_str: &str) -> Result<()> {
    let prefix = net.prefix_len() as u32;
    let host_bits = 32u32.saturating_sub(prefix);
    let total = 1u64.checked_shl(host_bits).unwrap_or(u64::MAX);
    if total > MAX_SUBNET_ADDRESSES {
        return Err(Error::invalid_input(format!(
            "subnet too large: {subnet_str} (max /16)"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct OpsConfig {
    pub concurrency: usize,
    pub scan_timeout_ms: u64,
    pub ping_timeout_ms: u64,
    pub dns_timeout_ms: u64,
}

impl Default for OpsConfig {
    fn default() -> Self {
        Self {
            concurrency: DEFAULT_CONCURRENCY,
            scan_timeout_ms: DEFAULT_SCAN_TIMEOUT_MS,
            ping_timeout_ms: DEFAULT_PING_TIMEOUT_MS,
            dns_timeout_ms: DEFAULT_DNS_TIMEOUT_MS,
        }
    }
}

/// High-level operations used by CLI/TUI/GUI/MCP to keep behavior consistent.
#[derive(Debug, Clone, Default)]
pub struct Ops {
    cfg: OpsConfig,
}

impl Ops {
    pub fn new(cfg: OpsConfig) -> Self {
        let mut cfg = cfg;
        cfg.concurrency = cfg.concurrency.max(1);
        cfg.scan_timeout_ms = cfg.scan_timeout_ms.max(1);
        cfg.ping_timeout_ms = cfg.ping_timeout_ms.max(1);
        cfg.dns_timeout_ms = cfg.dns_timeout_ms.max(1);
        Self { cfg }
    }

    pub fn config(&self) -> &OpsConfig {
        &self.cfg
    }

    pub async fn resolve_host_ip(&self, host: &str) -> Result<IpAddr> {
        resolve_host_ip_with_timeout(host, self.cfg.dns_timeout_ms).await
    }

    pub async fn discover_ipv4(
        &self,
        subnet: Option<String>,
        resolve: bool,
    ) -> Result<(String, Vec<Host>)> {
        self.discover_ipv4_with_progress(subnet, resolve, None)
            .await
    }

    pub async fn discover_ipv4_with_progress(
        &self,
        subnet: Option<String>,
        resolve: bool,
        progress: Option<Arc<dyn Fn(crate::discover::DiscoverProgress) + Send + Sync>>,
    ) -> Result<(String, Vec<Host>)> {
        let subnet_str = subnet.unwrap_or_else(default_ipv4_subnet_string);
        let net: Ipv4Net = subnet_str.parse().map_err(|e| {
            Error::invalid_input(format!("Invalid subnet format '{subnet_str}': {e}"))
        })?;
        ensure_subnet_limit(&net, &subnet_str)?;
        let engine = DiscoverEngine::new_with_timeouts(
            self.cfg.concurrency,
            self.cfg.ping_timeout_ms,
            self.cfg.dns_timeout_ms,
        );
        let hosts = engine
            .scan_subnet_with_progress(net, resolve, progress)
            .await;
        Ok((subnet_str, hosts))
    }

    pub async fn scan_ports(
        &self,
        host: &str,
        ports: Option<Vec<u16>>,
    ) -> Result<(IpAddr, Vec<PortResult>)> {
        self.scan_ports_with_progress(host, ports, None).await
    }

    pub async fn scan_ports_with_progress(
        &self,
        host: &str,
        ports: Option<Vec<u16>>,
        progress: Option<Arc<dyn Fn(crate::scan::PortScanProgress) + Send + Sync>>,
    ) -> Result<(IpAddr, Vec<PortResult>)> {
        let ip = self.resolve_host_ip(host).await?;
        let ports = ports.unwrap_or_else(default_ports);
        let scanner = PortScanner::new(self.cfg.concurrency);
        let results = scanner
            .scan_host_with_progress(ip, ports, self.cfg.scan_timeout_ms, progress)
            .await;
        Ok((ip, results))
    }

    pub async fn inspect_host(
        &self,
        host: String,
        ports: Option<Vec<u16>>,
    ) -> Result<InspectResult> {
        let ports = ports.unwrap_or_else(default_ports);
        let engine = InspectEngine::new_with_timeouts(
            self.cfg.concurrency,
            self.cfg.ping_timeout_ms,
            self.cfg.scan_timeout_ms,
            self.cfg.dns_timeout_ms,
        );
        engine.inspect(host, ports).await
    }

    pub async fn sweep_ipv4(
        &self,
        subnet: Option<String>,
        ports: Option<Vec<u16>>,
        resolve_hostnames: bool,
    ) -> Result<(String, Vec<SweepEntry>)> {
        self.sweep_ipv4_with_progress(subnet, ports, resolve_hostnames, None)
            .await
    }

    pub async fn sweep_ipv4_with_progress(
        &self,
        subnet: Option<String>,
        ports: Option<Vec<u16>>,
        resolve_hostnames: bool,
        progress: Option<Arc<dyn Fn(crate::sweep::SweepProgress) + Send + Sync>>,
    ) -> Result<(String, Vec<SweepEntry>)> {
        let subnet_str = subnet.unwrap_or_else(default_ipv4_subnet_string);
        let net: Ipv4Net = subnet_str.parse().map_err(|e| {
            Error::invalid_input(format!("Invalid subnet format '{subnet_str}': {e}"))
        })?;
        ensure_subnet_limit(&net, &subnet_str)?;
        let ports = ports.unwrap_or_else(default_ports);
        let engine = SweepEngine::new_with_timeouts(
            self.cfg.concurrency,
            self.cfg.ping_timeout_ms,
            self.cfg.scan_timeout_ms,
            self.cfg.dns_timeout_ms,
        );
        let results = engine
            .sweep_with_progress(net, ports, resolve_hostnames, progress)
            .await?;
        Ok((subnet_str, results))
    }

    pub async fn ping_host_summary(&self, host: &str, count: u32) -> Result<PingSummary> {
        let ip = self.resolve_host_ip(host).await?;
        let scanner = PingScanner::new(1);
        let mut sent: u32 = 0;
        let mut received: u32 = 0;
        let mut rtts: Vec<u64> = Vec::new();

        for _ in 0..count {
            sent += 1;
            let res = scanner.ping(ip, self.cfg.ping_timeout_ms).await;
            if res.alive {
                received += 1;
                if let Some(rtt) = res.rtt_ms {
                    rtts.push(rtt);
                }
            }
        }

        Ok(PingSummary::new(host.to_string(), ip, sent, received, rtts))
    }

    pub async fn dns_lookup(
        &self,
        host: &str,
        record: Option<String>,
    ) -> Result<Vec<crate::dns::DnsRecord>> {
        let record = record.map(|r| r.trim().to_uppercase());
        if record.as_deref().is_none() || matches!(record.as_deref(), Some("ALL" | "ANY")) {
            return crate::dns::lookup_all_records_timeout(host, self.cfg.dns_timeout_ms).await;
        }

        let record = record.unwrap_or_else(|| "A".to_string());
        let Some(parsed) = crate::dns::parse_record_type(&record) else {
            return Err(Error::invalid_input(format!(
                "unsupported DNS record type '{record}'"
            )));
        };

        crate::dns::lookup_record_timeout(host, parsed, self.cfg.dns_timeout_ms).await
    }

    pub fn list_interfaces(&self) -> Vec<InterfaceInfo> {
        NetworkManager::get_interfaces()
    }

    /// Discover services via mDNS/DNS-SD across a curated list of common
    /// service types. Waits up to `timeout` for responses.
    ///
    /// Pass an empty `service_types` slice to use
    /// [`crate::mdns::COMMON_SERVICE_TYPES`] as the default probe set.
    #[cfg(feature = "mdns")]
    pub async fn discover_mdns(
        &self,
        service_types: &[String],
        timeout: std::time::Duration,
    ) -> Result<Vec<crate::mdns::MdnsService>> {
        if service_types.is_empty() {
            crate::mdns::MdnsEngine::discover_common(timeout).await
        } else {
            let refs: Vec<&str> = service_types.iter().map(String::as_str).collect();
            crate::mdns::MdnsEngine::discover(&refs, timeout).await
        }
    }

    pub fn get_arp_table(&self) -> Result<Vec<ArpEntry>> {
        NetworkManager::get_arp_table()
    }

    pub fn pcap_check_support(&self) -> Result<Vec<String>> {
        PcapEngine::check_support()
    }

    pub fn capture_pcap(
        &self,
        interface: String,
        filter: Option<String>,
        duration: Option<u64>,
        output_file: Option<String>,
        max_packets: Option<usize>,
    ) -> Result<PcapResult> {
        let cfg = PcapConfig {
            interface,
            filter,
            output_file: output_file
                .unwrap_or_else(|| "capture.pcap".to_string())
                .into(),
            duration: duration.map(std::time::Duration::from_secs),
            max_packets,
        };
        PcapEngine::capture(cfg)
    }

    /// Async-friendly PCAP capture wrapper.
    ///
    /// PCAP capture is inherently blocking (libpcap read loop + file I/O). This
    /// runs it in a dedicated blocking thread so async runtimes (CLI/Tauri/MCP)
    /// remain responsive.
    pub async fn capture_pcap_async(
        &self,
        interface: String,
        filter: Option<String>,
        duration: Option<u64>,
        output_file: Option<String>,
        max_packets: Option<usize>,
    ) -> Result<PcapResult> {
        self.capture_pcap_async_with_cancel(
            interface,
            filter,
            duration,
            output_file,
            max_packets,
            None,
        )
        .await
    }

    pub async fn capture_pcap_async_with_cancel(
        &self,
        interface: String,
        filter: Option<String>,
        duration: Option<u64>,
        output_file: Option<String>,
        max_packets: Option<usize>,
        cancel: Option<PcapCancelToken>,
    ) -> Result<PcapResult> {
        let cfg = PcapConfig {
            interface,
            filter,
            output_file: output_file
                .unwrap_or_else(|| "capture.pcap".to_string())
                .into(),
            duration: duration.map(std::time::Duration::from_secs),
            max_packets,
        };

        let task =
            tokio::task::spawn_blocking(move || PcapEngine::capture_with_cancel(cfg, cancel));
        match task.await {
            Ok(res) => Ok(res?),
            Err(e) => Err(Error::Other(format!("pcap capture task failed: {e}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PingSummary {
    pub host: String,
    pub ip: IpAddr,
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f64,
    pub rtt_ms_min: Option<u64>,
    pub rtt_ms_max: Option<u64>,
    pub rtt_ms_avg: Option<f64>,
}

impl PingSummary {
    fn new(host: String, ip: IpAddr, sent: u32, received: u32, rtts: Vec<u64>) -> Self {
        let loss_pct = if sent == 0 {
            0.0
        } else {
            100.0 * (sent - received) as f64 / sent as f64
        };
        let rtt_ms_min = rtts.iter().min().copied();
        let rtt_ms_max = rtts.iter().max().copied();
        let rtt_ms_avg = if rtts.is_empty() {
            None
        } else {
            Some((rtts.iter().sum::<u64>() as f64) / (rtts.len() as f64))
        };
        Self {
            host,
            ip,
            sent,
            received,
            loss_pct,
            rtt_ms_min,
            rtt_ms_max,
            rtt_ms_avg,
        }
    }
}

/// Resolve a host string to an IP address.
///
/// - Accepts literal IPv4/IPv6 strings.
/// - Otherwise resolves A first, then AAAA.
pub async fn resolve_host_ip(host: &str) -> Result<IpAddr> {
    resolve_host_ip_with_timeout(host, crate::DEFAULT_DNS_TIMEOUT_MS).await
}

pub async fn resolve_host_ip_with_timeout(host: &str, dns_timeout_ms: u64) -> Result<IpAddr> {
    if let Ok(ip) = IpAddr::from_str(host) {
        return Ok(ip);
    }

    if let Ok(v4s) = crate::dns::resolve_a_timeout(host, dns_timeout_ms).await {
        if let Some(first) = v4s.first() {
            return IpAddr::from_str(first).map_err(|e| {
                Error::dns(format!("invalid IPv4 address '{first}' from resolver: {e}"))
            });
        }
    }
    if let Ok(v6s) = crate::dns::resolve_aaaa_timeout(host, dns_timeout_ms).await {
        if let Some(first) = v6s.first() {
            return IpAddr::from_str(first).map_err(|e| {
                Error::dns(format!("invalid IPv6 address '{first}' from resolver: {e}"))
            });
        }
    }

    Err(Error::dns(format!("unable to resolve host '{host}'")))
}
