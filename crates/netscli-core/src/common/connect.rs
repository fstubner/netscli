//! TCP connect for the port scanner, which must tell "refused" from "no
//! answer".
//!
//! Windows retries a SYN that was answered with a RST, so a connect to a
//! closed port only fails with `ConnectionRefused` after about 2 s (measured
//! 2026-10-02 on Windows 11: 2025-2047 ms to a LAN host, 2043 ms to
//! loopback). The port scanner gives up at 500 ms by default, so every closed
//! port read as filtered. Turning SYN retransmissions off for the socket
//! makes the first RST final: the same connects failed in 0-5 ms.
//!
//! With no retransmissions Windows abandons the connect after the initial
//! retransmission timeout, 1 s by default, whatever timeout the caller asked
//! for. So the initial timeout is set to the caller's timeout as well.

use std::io;
use std::net::SocketAddr;
use std::time::Duration;

use tokio::net::{TcpSocket, TcpStream};

/// Connect to `addr`, giving up after `timeout_ms`. A timeout is reported as
/// `ErrorKind::TimedOut`, the same kind the OS uses for an unanswered SYN.
pub(crate) async fn connect(addr: SocketAddr, timeout_ms: u64) -> io::Result<TcpStream> {
    let socket = if addr.is_ipv4() {
        TcpSocket::new_v4()?
    } else {
        TcpSocket::new_v6()?
    };
    #[cfg(windows)]
    windows::final_rst(&socket, timeout_ms);
    match tokio::time::timeout(Duration::from_millis(timeout_ms), socket.connect(addr)).await {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "connect timed out")),
    }
}

#[cfg(windows)]
mod windows {
    use std::os::windows::io::AsRawSocket;

    use tokio::net::TcpSocket;
    use windows_sys::Win32::Networking::WinSock::{
        WSAIoctl, SIO_TCP_INITIAL_RTO, SOCKET, TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS,
        TCP_INITIAL_RTO_PARAMETERS,
    };

    /// Turn off SYN retransmissions and set the initial retransmission
    /// timeout to `timeout_ms`. Best effort: if the ioctl is refused the
    /// connect still works, it is only slow to report a closed port.
    pub(super) fn final_rst(socket: &TcpSocket, timeout_ms: u64) {
        let params = TCP_INITIAL_RTO_PARAMETERS {
            Rtt: rtt(timeout_ms),
            // The C header defines this as (USHORT)-2 and assigns it to the
            // UCHAR field, which keeps the low byte.
            MaxSynRetransmissions: TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS as u8,
        };
        let mut returned = 0u32;
        // SAFETY: a valid socket handle, an input buffer of the declared size,
        // no output buffer, and no overlapped I/O.
        unsafe {
            WSAIoctl(
                socket.as_raw_socket() as SOCKET,
                SIO_TCP_INITIAL_RTO,
                &params as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<TCP_INITIAL_RTO_PARAMETERS>() as u32,
                std::ptr::null_mut(),
                0,
                &mut returned,
                std::ptr::null_mut(),
                None,
            );
        }
    }

    /// 65535 means "unspecified" to Windows, so the largest usable value is
    /// 65534 ms. 0 is not a timeout either.
    pub(super) fn rtt(timeout_ms: u64) -> u16 {
        timeout_ms.clamp(1, 65_534) as u16
    }

    #[cfg(test)]
    mod tests {
        use super::rtt;

        #[test]
        fn rtt_stays_inside_the_values_windows_accepts() {
            assert_eq!(rtt(0), 1);
            assert_eq!(rtt(500), 500);
            assert_eq!(rtt(65_535), 65_534);
            assert_eq!(rtt(u64::MAX), 65_534);
        }
    }
}
