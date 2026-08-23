use serde::Serialize;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Semaphore;

/// One ICMP backend per platform. They are not interchangeable: see the note
/// on `send_icmp_echo_v4` below for why Windows cannot use the raw socket.
#[cfg(not(windows))]
mod raw_icmp;
#[cfg(windows)]
mod windows_icmp;

#[cfg(not(windows))]
use raw_icmp::send_icmp_echo_v4;

/// Process-wide monotonic counter for ICMP echo sequence numbers.
///
/// Raw ICMP sockets on Linux see *every* ICMP packet destined for the host, so
/// concurrent pings that share the same (identifier, sequence) cannot reliably
/// match replies to the request that generated them. We use `pid` as the
/// identifier and a per-process atomic for `seq`.
static PING_SEQ: AtomicU16 = AtomicU16::new(1);

fn next_seq() -> u16 {
    // `fetch_add` wraps on u16 overflow; that's fine — after ~65k pings the seq
    // space recycles, but each in-flight ping at a given instant still has a
    // unique seq because we only compare against the few pings racing in the
    // current timeout window.
    PING_SEQ.fetch_add(1, Ordering::Relaxed)
}

/// Cache the raw-ICMP capability check — it opens and closes a real socket,
/// which on Windows is non-trivial and not something we should repeat per
/// scanner construction.
static RAW_ICMP_OK: OnceLock<bool> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct PingResult {
    pub ip: IpAddr,
    pub rtt_ms: Option<u64>,
    pub alive: bool,
    /// Sequence number actually used for this ping (monotonic per process).
    /// Useful for debugging concurrent scans against logging-enabled targets.
    pub seq: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Indicates which mechanism was used (e.g., `icmpv4`, `tcp-connect`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum PingBackend {
    /// Raw ICMPv4 via pnet (fast, but may require CAP_NET_RAW / admin privileges).
    RawIcmpV4,
    /// TCP connect probe (works without raw socket privileges, also supports IPv6 targets).
    TcpConnect,
}

#[derive(Clone)]
pub struct PingScanner {
    semaphore: Arc<Semaphore>,
    backend: PingBackend,
}

impl PingScanner {
    pub fn new(concurrency: usize) -> Self {
        let concurrency = concurrency.clamp(1, crate::MAX_CONCURRENCY);
        Self {
            semaphore: Arc::new(Semaphore::new(concurrency)),
            backend: if *RAW_ICMP_OK.get_or_init(can_use_raw_icmpv4) {
                PingBackend::RawIcmpV4
            } else {
                PingBackend::TcpConnect
            },
        }
    }

    pub async fn ping(&self, target: IpAddr, timeout_ms: u64) -> PingResult {
        let seq = next_seq();
        let _permit = match self.semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => {
                return PingResult {
                    ip: target,
                    rtt_ms: None,
                    alive: false,
                    seq,
                    error: Some("ping concurrency semaphore closed".to_string()),
                    method: None,
                };
            }
        };

        // Prefer ICMP when the platform offers it for this address family.
        // Otherwise fall back to the TCP probe, which is a weaker signal: it
        // can only prove a host is up by getting something back from a port.
        match (self.backend, target) {
            (PingBackend::RawIcmpV4, IpAddr::V4(_)) => ping_icmpv4(target, timeout_ms, seq).await,
            // Unix has no ICMPv6 path here, so v6 keeps falling back there.
            #[cfg(windows)]
            (_, IpAddr::V6(v6)) => ping_icmpv6(v6, timeout_ms, seq).await,
            _ => ping_tcp_probe(target, timeout_ms, seq).await,
        }
    }
}

#[cfg(windows)]
fn can_use_raw_icmpv4() -> bool {
    // Windows pings through the IP Helper API rather than a raw socket, and
    // `IcmpCreateFile` needs no privileges, so ICMP is always available.
    true
}

#[cfg(not(windows))]
use raw_icmp::can_use_raw_icmpv4;

async fn ping_icmpv4(target: IpAddr, timeout_ms: u64, seq: u16) -> PingResult {
    // Use tokio::spawn_blocking for pnet operations since they are synchronous.
    let handle = tokio::task::spawn_blocking(move || send_icmp_echo_v4(target, timeout_ms, seq));
    match handle.await {
        Ok(Ok(rtt)) => PingResult {
            ip: target,
            rtt_ms: Some(rtt),
            alive: true,
            seq,
            error: None,
            method: Some("icmpv4".to_string()),
        },
        Ok(Err(e)) => PingResult {
            ip: target,
            rtt_ms: None,
            alive: false,
            seq,
            error: Some(e.to_string()),
            method: Some("icmpv4".to_string()),
        },
        Err(e) => PingResult {
            ip: target,
            rtt_ms: None,
            alive: false,
            seq,
            error: Some(format!("ping task failed: {e}")),
            method: Some("icmpv4".to_string()),
        },
    }
}

#[cfg(windows)]
async fn ping_icmpv6(target: std::net::Ipv6Addr, timeout_ms: u64, seq: u16) -> PingResult {
    let outcome =
        tokio::task::spawn_blocking(move || windows_icmp::send_echo6(target, timeout_ms)).await;
    let (rtt_ms, error) = match outcome {
        Ok(Ok(rtt)) => (Some(rtt), None),
        Ok(Err(e)) => (None, Some(e.to_string())),
        Err(e) => (None, Some(format!("ping task failed: {e}"))),
    };
    PingResult {
        ip: IpAddr::V6(target),
        alive: rtt_ms.is_some(),
        rtt_ms,
        seq,
        error,
        method: Some("icmpv6".to_string()),
    }
}

async fn ping_tcp_probe(target: IpAddr, timeout_ms: u64, seq: u16) -> PingResult {
    use std::net::SocketAddr;
    use tokio::net::TcpStream;
    use tokio::time::timeout;

    // A small set of common ports that often yield quick, definitive responses.
    // We treat both success and connection refused as "host is alive".
    const PROBE_PORTS: &[u16] = &[80, 443, 22];

    let start = std::time::Instant::now();
    let mut last_err: Option<String> = None;

    for &port in PROBE_PORTS {
        let addr = SocketAddr::new(target, port);
        let attempt = timeout(Duration::from_millis(timeout_ms), TcpStream::connect(addr)).await;
        match attempt {
            Ok(Ok(_stream)) => {
                return PingResult {
                    ip: target,
                    rtt_ms: Some(start.elapsed().as_millis() as u64),
                    alive: true,
                    seq,
                    error: None,
                    method: Some("tcp-connect".to_string()),
                };
            }
            Ok(Err(e)) => {
                // Connection refused/reset still proves the host is reachable.
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::ConnectionReset
                ) {
                    return PingResult {
                        ip: target,
                        rtt_ms: Some(start.elapsed().as_millis() as u64),
                        alive: true,
                        seq,
                        error: None,
                        method: Some("tcp-connect".to_string()),
                    };
                }
                last_err = Some(format!("tcp probe port {port}: {e}"));
            }
            Err(_elapsed) => {
                last_err = Some(format!("tcp probe port {port}: timeout"));
            }
        }
    }

    PingResult {
        ip: target,
        rtt_ms: None,
        alive: false,
        seq,
        error: last_err,
        method: Some("tcp-connect".to_string()),
    }
}

/// Send a single ICMPv4 Echo Request and await a matching Echo Reply.
///
/// Windows and Unix take different routes here, and the reason is a measured
/// bug rather than portability pedantry. Pinging `127.0.0.1` on Windows --
/// or the machine's own LAN address -- reported 100% loss while the system
/// `ping` reported none.
///
/// Two things stacked up. Opening a raw ICMP socket needs administrator
/// rights, so an ordinary run never reached the ICMP path at all: it fell
/// back to the TCP probe below, which asks ports 80/443/22 and concludes a
/// host is down when nothing answers -- true of most machines asked about
/// themselves. Elevated runs have the separate, documented problem that a
/// Windows raw socket does not observe traffic to an address the host owns.
///
/// The IP Helper API sidesteps both: it needs no privileges and it reaches
/// local addresses. Unix keeps the raw socket, where loopback ICMP is
/// observable and this dependency would buy nothing.
#[cfg(windows)]
fn send_icmp_echo_v4(target: IpAddr, timeout_ms: u64, seq: u16) -> anyhow::Result<u64> {
    // `seq` is unused here: IcmpSendEcho owns its own request/reply matching
    // per handle, which is the job the identifier and sequence do on the raw
    // path. `PingResult` still reports the process-wide counter so the field
    // means the same thing on both platforms.
    let _ = seq;
    windows_icmp::send_echo(target, timeout_ms)
}
