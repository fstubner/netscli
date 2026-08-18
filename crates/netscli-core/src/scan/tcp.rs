use futures::stream::{self, StreamExt};
use std::net::{IpAddr, SocketAddr};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::time::timeout;

use super::probes::{first_banner_line, probe_http, probe_tls, read_banner};
use super::services::{classify_connect_error, guess_service, is_http_port, is_tls_port};
use super::types::{PortResult, PortStatus};
use crate::error::Result;

/// Concurrent TCP port scanner.
///
/// The `Arc<Semaphore>` caps TCP connects across *all* concurrent `scan_host`
/// calls on the same scanner instance. `buffer_unordered` alone would only
/// bound a single call. `SweepEngine` reuses one scanner across hundreds of
/// hosts in parallel, so without the shared permit pool a /24 sweep could
/// attempt hosts × ports simultaneous connects (easily 64k sockets).
pub struct PortScanner {
    semaphore: Arc<Semaphore>,
    pub(super) concurrency: usize,
}

#[derive(Debug, Clone)]
pub struct PortScanProgress {
    pub completed: usize,
    pub total: usize,
    pub port: u16,
    pub open: bool,
    pub open_found: usize,
}

impl PortScanner {
    pub fn new(concurrency: usize) -> Self {
        let concurrency = concurrency.clamp(1, crate::MAX_CONCURRENCY);
        Self {
            semaphore: Arc::new(Semaphore::new(concurrency)),
            concurrency,
        }
    }

    pub async fn scan_host(
        &self,
        target: IpAddr,
        ports: Vec<u16>,
        timeout_ms: u64,
    ) -> Result<Vec<PortResult>> {
        self.scan_host_with_progress(target, ports, timeout_ms, None)
            .await
    }

    /// Scan `ports` on `target`.
    ///
    /// Validates the port list rather than trusting the caller. `Ops` does
    /// the same check before calling in, but this is public API on a
    /// published crate: a consumer building a `Vec<u16>` by hand reached the
    /// scanner directly and neither the 4,096-port cap nor the port-0
    /// rejection applied. The doc comment on `Ops::resolve_ports` claimed
    /// "every scanning entry point funnels through here", and this was one
    /// of two that did not.
    pub async fn scan_host_with_progress(
        &self,
        target: IpAddr,
        ports: Vec<u16>,
        timeout_ms: u64,
        progress: Option<Arc<dyn Fn(PortScanProgress) + Send + Sync>>,
    ) -> Result<Vec<PortResult>> {
        if ports.is_empty() {
            return Ok(Vec::new());
        }
        crate::validate_ports(&ports)?;

        let total = ports.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let open_found = Arc::new(AtomicUsize::new(0));

        let results = stream::iter(ports)
            .map(|port| {
                let scanner = self.clone();
                let completed = completed.clone();
                let open_found = open_found.clone();
                let progress = progress.clone();
                async move {
                    let res = scanner.check_port(target, port, timeout_ms).await;
                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    let open_count = if res.open {
                        open_found.fetch_add(1, Ordering::SeqCst) + 1
                    } else {
                        open_found.load(Ordering::SeqCst)
                    };

                    if let Some(cb) = &progress {
                        cb(PortScanProgress {
                            completed: done,
                            total,
                            port,
                            open: res.open,
                            open_found: open_count,
                        });
                    }

                    res
                }
            })
            .buffer_unordered(self.concurrency)
            .collect::<Vec<PortResult>>()
            .await;

        Ok(results)
    }

    async fn check_port(&self, target: IpAddr, port: u16, timeout_ms: u64) -> PortResult {
        let _permit = match self.semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => {
                // Semaphore closed. Record the reason so downstream callers
                // can distinguish this from a genuinely closed port.
                return PortResult::new(port, PortStatus::Error, None)
                    .with_error("scanner shut down (semaphore closed)".to_string());
            }
        };

        let addr = SocketAddr::new(target, port);
        let service = Self::guess_service(port);
        let started = Instant::now();
        let result = timeout(Duration::from_millis(timeout_ms), TcpStream::connect(addr)).await;

        match result {
            Ok(Ok(stream)) => {
                let latency_ms = started.elapsed().as_millis() as u64;
                let mut result = PortResult::new(port, PortStatus::Open, service.clone())
                    .with_latency(latency_ms);
                self.enrich_open_port(target, port, stream, timeout_ms, &mut result)
                    .await;
                result
            }
            Ok(Err(e)) => match classify_connect_error(e.kind()) {
                PortStatus::Closed => PortResult::new(port, PortStatus::Closed, service)
                    .with_latency(started.elapsed().as_millis() as u64),
                PortStatus::Filtered => PortResult::new(port, PortStatus::Filtered, service),
                PortStatus::Error | PortStatus::Open => {
                    PortResult::new(port, PortStatus::Error, service)
                        .with_latency(started.elapsed().as_millis() as u64)
                        .with_error(e.to_string())
                }
            },
            Err(_) => PortResult::new(port, PortStatus::Filtered, service),
        }
    }

    async fn enrich_open_port(
        &self,
        target: IpAddr,
        port: u16,
        stream: TcpStream,
        timeout_ms: u64,
        result: &mut PortResult,
    ) {
        let service = result.service.as_deref();
        if is_tls_port(port, service) {
            if let Some((tls, http, banner, raw)) =
                probe_tls(target, port, stream, timeout_ms, service).await
            {
                result.tls = Some(tls);
                result.http = http;
                result.banner = banner;
                result.raw = raw;
            }
            return;
        }

        if is_http_port(port, service) {
            let mut stream = stream;
            if let Some((http, banner, raw)) =
                probe_http(&mut stream, &target.to_string(), timeout_ms).await
            {
                result.http = Some(http);
                result.banner = banner;
                result.raw = raw;
            }
            return;
        }

        let mut stream = stream;
        if let Some(raw) = read_banner(&mut stream, timeout_ms).await {
            result.banner = Some(first_banner_line(&raw));
            result.raw = Some(raw);
        }
    }

    pub(super) fn guess_service(port: u16) -> Option<String> {
        guess_service(port)
    }
}

impl Clone for PortScanner {
    fn clone(&self) -> Self {
        Self {
            semaphore: self.semaphore.clone(),
            concurrency: self.concurrency,
        }
    }
}
