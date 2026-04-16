use crate::discover::{DiscoverEngine, Host};
use crate::scan::{PortResult, PortScanner};
use anyhow::Result;
use futures::stream::{self, StreamExt};
use ipnet::Ipv4Net;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[derive(Debug, Clone, Serialize)]
pub struct SweepEntry {
    pub host: Host,
    pub open_ports: Vec<PortResult>,
}

#[derive(Debug, Clone, Copy)]
pub enum SweepPhase {
    DiscoverPing,
    DiscoverResolve,
    Scan,
}

#[derive(Debug, Clone)]
pub struct SweepProgress {
    pub phase: SweepPhase,
    pub completed: usize,
    pub total: usize,
    pub found: usize,
    pub ip: std::net::IpAddr,
}

pub struct SweepEngine {
    discover: DiscoverEngine,
    scanner: PortScanner,
    scan_timeout_ms: u64,
    host_concurrency: usize,
}

impl SweepEngine {
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
            discover: DiscoverEngine::new_with_timeouts(
                concurrency,
                ping_timeout_ms,
                dns_timeout_ms,
            ),
            scanner: PortScanner::new(concurrency),
            scan_timeout_ms: scan_timeout_ms.max(1),
            host_concurrency: concurrency,
        }
    }

    pub async fn sweep(
        &self,
        subnet: Ipv4Net,
        ports: Vec<u16>,
        resolve_hostnames: bool,
    ) -> Result<Vec<SweepEntry>> {
        self.sweep_with_progress(subnet, ports, resolve_hostnames, None)
            .await
    }

    /// Sweep a network with bounded concurrency.
    ///
    /// Progress reporting is optional and is invoked after each host scan completes.
    pub async fn sweep_with_progress(
        &self,
        subnet: Ipv4Net,
        ports: Vec<u16>,
        resolve_hostnames: bool,
        progress: Option<Arc<dyn Fn(SweepProgress) + Send + Sync>>,
    ) -> Result<Vec<SweepEntry>> {
        let discover_progress = progress.clone().map(|cb| {
            Arc::new(move |p: crate::discover::DiscoverProgress| {
                let phase = match p.phase {
                    crate::discover::DiscoverPhase::Ping => SweepPhase::DiscoverPing,
                    crate::discover::DiscoverPhase::Resolve => SweepPhase::DiscoverResolve,
                };
                cb(SweepProgress {
                    phase,
                    completed: p.completed,
                    total: p.total,
                    found: p.found,
                    ip: p.ip,
                });
            }) as Arc<dyn Fn(crate::discover::DiscoverProgress) + Send + Sync>
        });

        let hosts = self
            .discover
            .scan_subnet_with_progress(subnet, resolve_hostnames, discover_progress)
            .await;
        let total_hosts = hosts.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let open_hosts = Arc::new(AtomicUsize::new(0));
        let ports = Arc::new(ports);

        let scan_timeout_ms = self.scan_timeout_ms;
        let scanner = self.scanner.clone();

        let mut entries = stream::iter(hosts)
            .map(|h| {
                let scanner = scanner.clone();
                let ports = ports.clone();
                let completed = completed.clone();
                let open_hosts = open_hosts.clone();
                let progress = progress.clone();
                async move {
                    let host_ip = h.ip;
                    let open_ports = scanner
                        .scan_host(host_ip, (*ports).clone(), scan_timeout_ms)
                        .await
                        .into_iter()
                        .filter(|p| p.open)
                        .collect();

                    let entry = SweepEntry {
                        host: h,
                        open_ports,
                    };

                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    if let Some(cb) = &progress {
                        let found = if entry.open_ports.is_empty() {
                            open_hosts.load(Ordering::SeqCst)
                        } else {
                            open_hosts.fetch_add(1, Ordering::SeqCst) + 1
                        };
                        cb(SweepProgress {
                            phase: SweepPhase::Scan,
                            completed: done,
                            total: total_hosts,
                            found,
                            ip: host_ip,
                        });
                    }

                    entry
                }
            })
            .buffer_unordered(self.host_concurrency)
            .collect::<Vec<SweepEntry>>()
            .await;

        // Provide deterministic output order (useful for CLI/TUI and tests).
        entries.sort_by_key(|e| e.host.ip);
        Ok(entries)
    }
}
