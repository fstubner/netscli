use serde::Serialize;
use std::net::IpAddr;
use std::str::FromStr;

use super::config::Ops;
use crate::error::{Error, Result};
use crate::PingScanner;

impl Ops {
    pub async fn resolve_host_ip(&self, host: &str) -> Result<IpAddr> {
        resolve_host_ip_with_timeout(host, self.cfg.dns_timeout_ms).await
    }

    pub async fn ping_host_summary(&self, host: &str, count: u32) -> Result<PingSummary> {
        // Clamped, not rejected: asking for more pings than the cap is a
        // request for "a lot", and the loop below is sequential, so the count
        // multiplies directly into how long this call blocks.
        let count = count.min(crate::MAX_PING_COUNT);
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

    pub async fn trace_route(
        &self,
        host: &str,
        max_hops: u32,
        resolve: bool,
    ) -> Result<crate::TraceResult> {
        crate::trace_route(host, max_hops, resolve, None).await
    }

    pub async fn trace_route_with_progress(
        &self,
        host: &str,
        max_hops: u32,
        resolve: bool,
        progress: Option<tokio::sync::watch::Sender<String>>,
    ) -> Result<crate::TraceResult> {
        crate::trace_route(host, max_hops, resolve, progress).await
    }

    pub async fn reverse_lookup(&self, ip: &str) -> Result<Option<String>> {
        let ip = IpAddr::from_str(ip)
            .map_err(|e| Error::invalid_input(format!("invalid IP address '{ip}': {e}")))?;
        Ok(crate::dns::reverse_lookup_best_effort_timeout(ip, self.cfg.dns_timeout_ms).await)
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
