use crate::arp::NetworkManager;
use crate::oui::lookup_vendor;
use crate::ping::PingScanner;
use futures::stream::{self, StreamExt};
use ipnet::Ipv4Net;
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[derive(Debug, Clone, Serialize)]
pub struct Host {
    pub ip: IpAddr,
    pub hostname: Option<String>,
    pub mac: Option<String>,
    pub vendor: Option<String>,
    pub rtt_ms: Option<u64>,
}

pub struct DiscoverEngine {
    ping_scanner: PingScanner,
    concurrency: usize,
    ping_timeout_ms: u64,
    dns_timeout_ms: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum DiscoverPhase {
    Ping,
    Resolve,
}

#[derive(Debug, Clone)]
pub struct DiscoverProgress {
    pub phase: DiscoverPhase,
    pub completed: usize,
    pub total: usize,
    pub found: usize,
    pub ip: IpAddr,
}

impl DiscoverEngine {
    pub fn new(concurrency: usize) -> Self {
        Self::new_with_timeouts(
            concurrency,
            crate::DEFAULT_PING_TIMEOUT_MS,
            crate::DEFAULT_DNS_TIMEOUT_MS,
        )
    }

    pub fn new_with_timeouts(
        concurrency: usize,
        ping_timeout_ms: u64,
        dns_timeout_ms: u64,
    ) -> Self {
        let concurrency = concurrency.max(1);
        Self {
            ping_scanner: PingScanner::new(concurrency),
            concurrency,
            ping_timeout_ms: ping_timeout_ms.max(1),
            dns_timeout_ms: dns_timeout_ms.max(1),
        }
    }

    pub async fn scan_subnet(&self, subnet: Ipv4Net, resolve: bool) -> Vec<Host> {
        self.scan_subnet_with_progress(subnet, resolve, None).await
    }

    pub async fn scan_subnet_with_progress(
        &self,
        subnet: Ipv4Net,
        resolve: bool,
        progress: Option<Arc<dyn Fn(DiscoverProgress) + Send + Sync>>,
    ) -> Vec<Host> {
        let ips: Vec<IpAddr> = subnet.hosts().map(IpAddr::V4).collect();

        // 1) Ping first (fast), to avoid reverse-DNS work on dead hosts.
        let total = ips.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let found = Arc::new(AtomicUsize::new(0));
        let ping_results = stream::iter(ips)
            .map(|ip| {
                let scanner = self.ping_scanner.clone();
                let timeout_ms = self.ping_timeout_ms;
                let completed = completed.clone();
                let found = found.clone();
                let progress = progress.clone();
                async move {
                    let res = scanner.ping(ip, timeout_ms).await;
                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    // Capture `found` *after* both atomic updates settle.
                    // Using a single load for both branches avoids the
                    // previous inconsistency where an unreachable IP could
                    // be reported with a `found` count that was updated by
                    // a concurrent task between this task's two loads.
                    if res.alive {
                        found.fetch_add(1, Ordering::SeqCst);
                    }
                    let found_snapshot = found.load(Ordering::SeqCst);

                    if let Some(cb) = &progress {
                        if res.alive || done == total || done.is_multiple_of(10) {
                            cb(DiscoverProgress {
                                phase: DiscoverPhase::Ping,
                                completed: done,
                                total,
                                found: found_snapshot,
                                ip,
                            });
                        }
                    }

                    res
                }
            })
            .buffer_unordered(self.concurrency)
            .collect::<Vec<crate::ping::PingResult>>()
            .await;

        let alive: Vec<crate::ping::PingResult> =
            ping_results.into_iter().filter(|r| r.alive).collect();

        // 2) Load ARP/neighbor table once and reuse it.
        let arp_map: HashMap<IpAddr, crate::arp::ArpEntry> = NetworkManager::get_arp_table()
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.ip, e))
            .collect();

        // 3) Optionally reverse-DNS alive hosts using a single resolver.
        let hostname_map: HashMap<IpAddr, Option<String>> = if resolve {
            let ips = alive.iter().map(|r| r.ip).collect::<Vec<_>>();
            let concurrency = self.concurrency.min(32);
            let total = ips.len();
            let completed = Arc::new(AtomicUsize::new(0));
            let resolved = Arc::new(AtomicUsize::new(0));
            stream::iter(ips)
                .map(|ip| {
                    let dns_timeout_ms = self.dns_timeout_ms;
                    let completed = completed.clone();
                    let resolved = resolved.clone();
                    let progress = progress.clone();
                    async move {
                        let name =
                            crate::dns::reverse_lookup_best_effort_timeout(ip, dns_timeout_ms)
                                .await;
                        let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        if name.is_some() {
                            resolved.fetch_add(1, Ordering::SeqCst);
                        }
                        let resolved_count = resolved.load(Ordering::SeqCst);

                        if let Some(cb) = &progress {
                            if name.is_some() || done == total || done.is_multiple_of(5) {
                                cb(DiscoverProgress {
                                    phase: DiscoverPhase::Resolve,
                                    completed: done,
                                    total,
                                    found: resolved_count,
                                    ip,
                                });
                            }
                        }

                        (ip, name)
                    }
                })
                .buffer_unordered(concurrency)
                .collect::<Vec<(IpAddr, Option<String>)>>()
                .await
                .into_iter()
                .collect()
        } else {
            HashMap::new()
        };

        alive
            .into_iter()
            .map(|r| {
                let hostname = hostname_map.get(&r.ip).cloned().unwrap_or(None);
                let mac_entry = arp_map.get(&r.ip);
                let mac_str = mac_entry.map(|e| e.mac.to_string());
                let vendor = mac_entry
                    .and_then(|e| e.vendor.clone())
                    .or_else(|| mac_str.as_deref().and_then(lookup_vendor));
                Host {
                    ip: r.ip,
                    hostname,
                    mac: mac_str,
                    vendor,
                    rtt_ms: r.rtt_ms,
                }
            })
            .collect()
    }
}
