//! ICMPv4 echo over a raw socket, via pnet.
//!
//! Unix only. See the note on `send_icmp_echo_v4` in the parent module for
//! why Windows cannot use this path.

use pnet_packet::icmp::{echo_reply, echo_request, IcmpTypes};
use pnet_packet::ip::IpNextHeaderProtocols;
use pnet_packet::util::checksum;
use pnet_packet::Packet;
use pnet_transport::{transport_channel, TransportChannelType, TransportReceiver};
use std::net::IpAddr;
use std::time::Duration;

/// Best-effort capability check: if we can open an ICMPv4 layer3 channel, raw
/// ping is usable. This avoids making discovery useless when unprivileged.
/// Called once via the parent's `RAW_ICMP_OK` OnceLock.
pub(super) fn can_use_raw_icmpv4() -> bool {
    let protocol = TransportChannelType::Layer3(IpNextHeaderProtocols::Icmp);
    transport_channel(4096, protocol).is_ok()
}

/// Send a single ICMPv4 Echo Request and await a matching Echo Reply.
///
/// Filters replies by (address, identifier, sequence) so overlapping pings
/// from other tasks on the same host don't steal each other's replies. The
/// Windows backend needs no equivalent: `IcmpSendEcho` matches replies to
/// requests itself, per handle.
pub(super) fn send_icmp_echo_v4(target: IpAddr, timeout_ms: u64, seq: u16) -> anyhow::Result<u64> {
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
