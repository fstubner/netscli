use crate::error::Result;
use crate::ping::{PingResult, PingScanner};
use crate::scan::{PortResult, PortScanner};
use serde::Serialize;
use std::net::IpAddr;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct InspectResult {
    pub host: String,
    pub ip: Option<IpAddr>,
    pub ping: Option<PingResult>,
    pub ports: Vec<PortResult>,
    pub open_ports: Vec<PortResult>,
    pub hostname: Option<String>,
    /// From the local ARP/neighbour table, so only for a host on the same
    /// network segment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// A best guess at the OS, with the clues behind it. See `os_hint`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_hint: Option<crate::os_hint::OsHint>,
}

pub struct InspectEngine {
    ping: PingScanner,
    scan: PortScanner,
    ping_timeout_ms: u64,
    scan_timeout_ms: u64,
    dns_timeout_ms: u64,
}

impl InspectEngine {
    pub fn new(concurrency: usize) -> Self {
        Self::new_with_timeouts(
            concurrency,
            crate::DEFAULT_PING_TIMEOUT_MS,
            crate::DEFAULT_SCAN_TIMEOUT_MS,
            crate::DEFAULT_DNS_TIMEOUT_MS,
        )
    }

    pub fn new_with_timeouts(
        concurrency: usize,
        ping_timeout_ms: u64,
        scan_timeout_ms: u64,
        dns_timeout_ms: u64,
    ) -> Self {
        let concurrency = concurrency.clamp(1, crate::MAX_CONCURRENCY);
        Self {
            ping: PingScanner::new(concurrency),
            scan: PortScanner::new(concurrency),
            ping_timeout_ms: ping_timeout_ms.max(1),
            scan_timeout_ms: scan_timeout_ms.max(1),
            dns_timeout_ms: dns_timeout_ms.max(1),
        }
    }

    pub async fn inspect(&self, host: String, ports: Vec<u16>) -> Result<InspectResult> {
        // Validate before doing any work. `Ops::inspect_host` checks too, but
        // this engine is public API and was reachable with a hand-built
        // `Vec<u16>` that skipped both the 4,096-port cap and the port-0
        // rejection.
        if !ports.is_empty() {
            crate::validate_ports(&ports)?;
        }

        let ip_for_scan =
            crate::ops::resolve_host_ip_with_timeout(&host, self.dns_timeout_ms).await?;

        // Run ping, scan, and reverse-DNS concurrently to keep inspect latency bounded
        // by the slowest of the three rather than their sum.
        let ping_fut = self.ping.ping(ip_for_scan, self.ping_timeout_ms);
        let scan_fut = self
            .scan
            .scan_host(ip_for_scan, ports, self.scan_timeout_ms);
        let hostname_fut =
            crate::dns::reverse_lookup_best_effort_timeout(ip_for_scan, self.dns_timeout_ms);
        // Two more clues for the OS hint, alongside the rest. SMB on 445 is
        // asked whether or not 445 was in the port list: it's part of what
        // inspecting a host means, and a closed port costs one refused
        // connect. The ARP lookup shells out on Windows and macOS, so it runs
        // off the async workers.
        let smb_wait = Duration::from_millis(self.scan_timeout_ms.max(1_000));
        let smb_fut = crate::os_hint::smb::query(ip_for_scan, smb_wait);
        let arp_fut =
            tokio::task::spawn_blocking(move || crate::arp::NetworkManager::find_mac(&ip_for_scan));

        let (ping_res, ports_res, hostname, smb, arp) =
            tokio::join!(ping_fut, scan_fut, hostname_fut, smb_fut, arp_fut);

        let ports = ports_res?;
        let open_ports = ports.iter().filter(|p| p.open).cloned().collect();
        let arp = arp.ok().flatten();
        let mac = arp.as_ref().map(|entry| entry.mac.to_string());
        let vendor = arp.and_then(|entry| entry.vendor);
        let os_hint = crate::os_hint::hint(&crate::os_hint::Clues {
            ttl: ping_res.ttl,
            ports: &ports,
            vendor: vendor.as_deref(),
            smb: smb.as_ref(),
        });

        Ok(InspectResult {
            host,
            ip: Some(ip_for_scan),
            ping: Some(ping_res),
            ports,
            open_ports,
            hostname,
            mac,
            vendor,
            os_hint,
        })
    }
}
