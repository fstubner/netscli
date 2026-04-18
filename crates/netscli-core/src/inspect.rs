use crate::error::Result;
use crate::ping::{PingResult, PingScanner};
use crate::scan::{PortResult, PortScanner};
use serde::Serialize;
use std::net::IpAddr;

#[derive(Debug, Clone, Serialize)]
pub struct InspectResult {
    pub host: String,
    pub ip: Option<IpAddr>,
    pub ping: Option<PingResult>,
    pub open_ports: Vec<PortResult>,
    pub hostname: Option<String>,
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
        let concurrency = concurrency.max(1);
        Self {
            ping: PingScanner::new(concurrency),
            scan: PortScanner::new(concurrency),
            ping_timeout_ms: ping_timeout_ms.max(1),
            scan_timeout_ms: scan_timeout_ms.max(1),
            dns_timeout_ms: dns_timeout_ms.max(1),
        }
    }

    pub async fn inspect(&self, host: String, ports: Vec<u16>) -> Result<InspectResult> {
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

        let (ping_res, ports_res, hostname) = tokio::join!(ping_fut, scan_fut, hostname_fut);

        Ok(InspectResult {
            host,
            ip: Some(ip_for_scan),
            ping: Some(ping_res),
            open_ports: ports_res.into_iter().filter(|p| p.open).collect(),
            hostname,
        })
    }
}
