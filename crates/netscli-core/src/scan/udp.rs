//! UDP port scanning for the common LAN services.
//!
//! UDP has no handshake, so a port only answers if the service understands
//! what it was sent. Each well-known port gets the request its service
//! expects -- a DNS query, an NTP client packet, a NetBIOS name query, an
//! SSDP search, an mDNS query -- and any other port an empty datagram.
//!
//! What comes back decides the status:
//!
//! - a reply: `open`;
//! - an ICMP port-unreachable, which the OS reports on a connected socket as
//!   a refused or reset connection: `closed`;
//! - nothing within the wait: `open|filtered`. The service may be there and
//!   ignored a probe it didn't understand, or a firewall dropped it. UDP
//!   can't tell those apart; nmap reports the same status for the same
//!   reason.
//!
//! No raw sockets, so no administrator rights: an ordinary connected UDP
//! socket both sends the probe and learns about the port-unreachable. SNMP is
//! deliberately not probed. Getting an answer means sending the default
//! community string `public`, which some networks log as a login attempt.

use futures::stream::{self, StreamExt};
use std::io::ErrorKind;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::sync::Semaphore;
use tokio::time::timeout;

mod probes;

use super::services::guess_service;
use super::tcp::PortScanProgress;
use super::types::{PortResult, PortStatus, Protocol};
use crate::error::Result;
use probes::{describe_reply, probe_for};

/// The ports `--udp` checks when no port list is given: the services that
/// answer an unauthenticated request on most LANs.
pub const DEFAULT_UDP_PORTS: &[u16] = &[53, 123, 137, 1900, 5353];

/// The shortest wait for a reply, whatever the TCP connect timeout is. A
/// UDP service answers after doing work (a NetBIOS name table, an SSDP
/// description), not at connect speed, and the default TCP timeout of 500 ms
/// cut off real replies from slower devices.
const MIN_REPLY_WAIT_MS: u64 = 1_000;

/// Concurrent UDP port scanner. Same permit model as `PortScanner`.
#[derive(Clone)]
pub struct UdpScanner {
    semaphore: Arc<Semaphore>,
    concurrency: usize,
}

impl UdpScanner {
    pub fn new(concurrency: usize) -> Self {
        let concurrency = concurrency.clamp(1, crate::MAX_CONCURRENCY);
        Self {
            semaphore: Arc::new(Semaphore::new(concurrency)),
            concurrency,
        }
    }

    /// Probe `ports` on `target` over UDP. Validates the port list, as
    /// `PortScanner` does, because this is public API.
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
        let wait = Duration::from_millis(timeout_ms.max(MIN_REPLY_WAIT_MS));
        let completed = Arc::new(AtomicUsize::new(0));
        let open_found = Arc::new(AtomicUsize::new(0));

        let results = stream::iter(ports)
            .map(|port| {
                let scanner = self.clone();
                let completed = completed.clone();
                let open_found = open_found.clone();
                let progress = progress.clone();
                async move {
                    let res = scanner.check_port(target, port, wait).await;
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

    async fn check_port(&self, target: IpAddr, port: u16, wait: Duration) -> PortResult {
        let service = guess_service(port);
        let result = |status| udp_result(port, status, service.clone());
        let _permit = match self.semaphore.acquire().await {
            Ok(permit) => permit,
            Err(_) => {
                return result(PortStatus::Error)
                    .with_error("scanner shut down (semaphore closed)".to_string())
            }
        };

        let local: SocketAddr = match target {
            IpAddr::V4(_) => (Ipv4Addr::UNSPECIFIED, 0).into(),
            IpAddr::V6(_) => (Ipv6Addr::UNSPECIFIED, 0).into(),
        };
        let socket = match UdpSocket::bind(local).await {
            Ok(socket) => socket,
            Err(e) => return result(PortStatus::Error).with_error(e.to_string()),
        };
        if let Err(e) = socket.connect((target, port)).await {
            return result(PortStatus::Error).with_error(e.to_string());
        }

        let started = Instant::now();
        if let Err(e) = socket.send(probe_for(port)).await {
            return if is_port_unreachable(e.kind()) {
                result(PortStatus::Closed).with_latency(elapsed_ms(started))
            } else {
                result(PortStatus::Error).with_error(e.to_string())
            };
        }

        let mut buf = [0u8; 2048];
        match timeout(wait, socket.recv(&mut buf)).await {
            Ok(Ok(len)) => {
                let mut open = result(PortStatus::Open).with_latency(elapsed_ms(started));
                open.banner = describe_reply(port, &buf[..len]);
                open
            }
            Ok(Err(e)) if is_port_unreachable(e.kind()) => {
                result(PortStatus::Closed).with_latency(elapsed_ms(started))
            }
            Ok(Err(e)) => result(PortStatus::Error).with_error(e.to_string()),
            Err(_) => result(PortStatus::OpenFiltered),
        }
    }
}

fn udp_result(port: u16, status: PortStatus, service: Option<String>) -> PortResult {
    let mut result = PortResult::new(port, status, service);
    result.protocol = Protocol::Udp;
    result
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

/// An ICMP port-unreachable, as a connected UDP socket reports it: refused
/// on Linux and macOS, reset on Windows (WSAECONNRESET).
fn is_port_unreachable(kind: ErrorKind) -> bool {
    matches!(
        kind,
        ErrorKind::ConnectionRefused | ErrorKind::ConnectionReset
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_unreachable_is_refused_on_unix_and_reset_on_windows() {
        assert!(is_port_unreachable(ErrorKind::ConnectionRefused));
        assert!(is_port_unreachable(ErrorKind::ConnectionReset));
        assert!(!is_port_unreachable(ErrorKind::TimedOut));
    }

    #[tokio::test]
    async fn a_closed_local_port_is_closed_and_an_answering_one_open() {
        // Something listening: bind a socket that echoes one datagram.
        let server = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let open_port = server.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut buf = [0u8; 64];
            if let Ok((len, from)) = server.recv_from(&mut buf).await {
                let _ = server.send_to(&buf[..len.max(1)], from).await;
            }
        });
        // Nothing listening: bind, note the port, and close it again.
        let closed_port = {
            let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            socket.local_addr().unwrap().port()
        };

        let scanner = UdpScanner::new(4);
        let results = scanner
            .scan_host_with_progress(
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                vec![open_port, closed_port],
                500,
                None,
            )
            .await
            .unwrap();
        let status_of = |port| results.iter().find(|r| r.port == port).unwrap().status;
        assert_eq!(status_of(open_port), PortStatus::Open);
        assert_eq!(status_of(closed_port), PortStatus::Closed);
        assert!(results.iter().all(|r| r.protocol == Protocol::Udp));
    }
}
