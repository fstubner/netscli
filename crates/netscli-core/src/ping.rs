use pnet_packet::icmp::{echo_reply, echo_request, IcmpTypes};
use pnet_packet::ip::IpNextHeaderProtocols;
use pnet_packet::util::checksum;
use pnet_packet::Packet;
use pnet_transport::{transport_channel, TransportChannelType, TransportReceiver};
use serde::Serialize;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Semaphore;

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
        let concurrency = concurrency.max(1);
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

        // Prefer raw ICMPv4 when available and target is IPv4. Otherwise fall back to TCP probe.
        match (self.backend, target) {
            (PingBackend::RawIcmpV4, IpAddr::V4(_)) => ping_icmpv4(target, timeout_ms, seq).await,
            _ => ping_tcp_probe(target, timeout_ms, seq).await,
        }
    }
}

fn can_use_raw_icmpv4() -> bool {
    // Best-effort capability check: if we can open an ICMPv4 layer3 channel, raw ping is usable.
    // This avoids making discovery completely useless when running unprivileged.
    // Called once via `RAW_ICMP_OK` OnceLock — construction of the transport
    // channel is non-trivial on Windows so we don't repeat it per scanner.
    let protocol = TransportChannelType::Layer3(IpNextHeaderProtocols::Icmp);
    transport_channel(4096, protocol).is_ok()
}

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
/// Filters replies by (address, identifier, sequence) so overlapping pings
/// from other tasks on the same host don't steal each other's replies.
fn send_icmp_echo_v4(target: IpAddr, timeout_ms: u64, seq: u16) -> anyhow::Result<u64> {
    let protocol = TransportChannelType::Layer3(IpNextHeaderProtocols::Icmp);
    let (mut tx, mut rx) = transport_channel(4096, protocol)?;
    configure_read_timeout(&rx, Duration::from_millis(10))?;

    let identifier = std::process::id() as u16;

    let mut buffer = [0u8; 64];
    let mut echo_packet = echo_request::MutableEchoRequestPacket::new(&mut buffer)
        .ok_or_else(|| anyhow::anyhow!("failed to build ICMP echo request packet"))?;

    echo_packet.set_icmp_type(IcmpTypes::EchoRequest);
    echo_packet.set_identifier(identifier);
    echo_packet.set_sequence_number(seq);

    let checksum = checksum(echo_packet.packet(), 1);
    echo_packet.set_checksum(checksum);

    let start = std::time::Instant::now();
    tx.send_to(echo_packet, target)?;

    let mut iter = pnet_transport::icmp_packet_iter(&mut rx);
    let end_time = start + Duration::from_millis(timeout_ms);

    while std::time::Instant::now() < end_time {
        match iter.next() {
            Ok((packet, addr)) => {
                if addr != target || packet.get_icmp_type() != IcmpTypes::EchoReply {
                    continue;
                }
                // Parse the echo-reply body so we can confirm identifier
                // and sequence match OUR request rather than another
                // concurrent ping's. `EchoReplyPacket::new` accepts the
                // full ICMP packet bytes (the type/code/checksum header
                // plus identifier/seq fields) — use `packet.packet()`
                // here, not `.payload()`.
                if let Some(reply) = echo_reply::EchoReplyPacket::new(packet.packet()) {
                    if reply.get_identifier() == identifier && reply.get_sequence_number() == seq {
                        return Ok(start.elapsed().as_millis() as u64);
                    }
                    // Not ours — keep reading until the timeout.
                }
            }
            Err(_) => {
                // Read error — usually just the read-timeout firing. Yield
                // briefly so we don't spin the CPU when there's no traffic.
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }

    Err(anyhow::anyhow!("Timeout"))
}

fn configure_read_timeout(rx: &TransportReceiver, timeout: Duration) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        pnet_sys::set_socket_receive_timeout(rx.socket.fd, timeout)
            .map_err(|e| anyhow::anyhow!("failed to set read timeout: {e}"))?;
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Networking::WinSock::{
            setsockopt, SOCKET_ERROR, SOL_SOCKET, SO_RCVTIMEO,
        };

        let timeout_ms = timeout.as_millis().min(i32::MAX as u128) as i32;
        let result = unsafe {
            setsockopt(
                rx.socket.fd,
                SOL_SOCKET,
                SO_RCVTIMEO,
                (&timeout_ms as *const i32).cast(),
                std::mem::size_of::<i32>() as i32,
            )
        };
        if result == SOCKET_ERROR {
            return Err(anyhow::anyhow!(
                "failed to set read timeout: {}",
                std::io::Error::last_os_error()
            ));
        }
    }

    Ok(())
}
