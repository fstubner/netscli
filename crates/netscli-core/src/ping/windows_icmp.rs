//! ICMP echo on Windows, via the IP Helper API.
//!
//! `IcmpSendEcho` is the platform's own ping primitive. It works without
//! administrator rights, which the raw path does not, and it reaches loopback
//! and any address this host owns. Both properties are load-bearing: see the
//! note on `send_icmp_echo_v4` for the failure each one fixes.

use std::net::{IpAddr, Ipv6Addr};
use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
use windows_sys::Win32::NetworkManagement::IpHelper::{
    Icmp6CreateFile, Icmp6SendEcho2, IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho,
    ICMPV6_ECHO_REPLY_LH, ICMP_ECHO_REPLY, IP_REQ_TIMED_OUT, IP_SUCCESS,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET6, SOCKADDR_IN6};

/// Payload sent with each echo. Content is irrelevant to the result; a
/// recognisable string just makes the packets readable in a capture.
const PAYLOAD: &[u8] = b"netscli-ping";

/// Closes the ICMP handle however we leave the function.
///
/// Every early return below is an error path, and each one used to be a
/// leaked kernel handle. A scan is thousands of pings, so that is a real
/// leak rather than a tidiness point.
struct IcmpHandle(windows_sys::Win32::Foundation::HANDLE);

impl Drop for IcmpHandle {
    fn drop(&mut self) {
        unsafe { IcmpCloseHandle(self.0) };
    }
}

pub fn send_echo(target: IpAddr, timeout_ms: u64) -> anyhow::Result<u64> {
    let IpAddr::V4(v4) = target else {
        anyhow::bail!("IcmpSendEcho supports IPv4 only");
    };

    let handle = unsafe { IcmpCreateFile() };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        anyhow::bail!("IcmpCreateFile failed: {}", std::io::Error::last_os_error());
    }
    let handle = IcmpHandle(handle);

    // The reply buffer holds one ICMP_ECHO_REPLY, the echoed payload, and
    // room for the 8-byte ICMP error body Windows may append. Undersizing
    // it makes IcmpSendEcho fail with IP_BUF_TOO_SMALL rather than write
    // out of bounds, but there is no reason to find out.
    let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + PAYLOAD.len() + 8];

    // `destinationaddress` is an in_addr: the four octets in network
    // order, read as a u32 in the host's own byte order.
    let destination = u32::from_ne_bytes(v4.octets());
    let timeout = u32::try_from(timeout_ms).unwrap_or(u32::MAX);

    let replies = unsafe {
        IcmpSendEcho(
            handle.0,
            destination,
            PAYLOAD.as_ptr().cast(),
            PAYLOAD.len() as u16,
            std::ptr::null(),
            reply.as_mut_ptr().cast(),
            reply.len() as u32,
            timeout,
        )
    };

    if replies == 0 {
        // A timeout arrives here as a failed call, not as a reply with a
        // timeout status, so it has to be recognised from the error code.
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(IP_REQ_TIMED_OUT as i32) {
            anyhow::bail!("Timeout");
        }
        anyhow::bail!("IcmpSendEcho failed: {error}");
    }

    // Safe: IcmpSendEcho reported at least one reply, so it has written a
    // full ICMP_ECHO_REPLY at the head of a buffer we sized above. `read_unaligned`
    // because a Vec<u8> carries no alignment guarantee for the struct.
    let echo = unsafe { reply.as_ptr().cast::<ICMP_ECHO_REPLY>().read_unaligned() };

    match echo.Status {
        IP_SUCCESS => Ok(u64::from(echo.RoundTripTime)),
        IP_REQ_TIMED_OUT => anyhow::bail!("Timeout"),
        // Unreachable, TTL expired and friends all land here. The host did
        // not answer, which is all the caller needs; the code identifies
        // which flavour for anyone reading the error.
        status => anyhow::bail!("ICMP status {status}"),
    }
}

/// Send an ICMPv6 echo and wait for the reply.
///
/// IPv6 had no ICMP path at all before this: it fell through to the TCP
/// probe, so `ping ::1` reported total loss for the same reason IPv4 loopback
/// did. `Icmp6SendEcho2` differs from its v4 counterpart in wanting both
/// endpoints as socket addresses, and the source is not optional -- passing a
/// zeroed `SOCKADDR_IN6` is how you say "any", which lets the stack pick.
pub fn send_echo6(target: Ipv6Addr, timeout_ms: u64) -> anyhow::Result<u64> {
    let handle = unsafe { Icmp6CreateFile() };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        anyhow::bail!(
            "Icmp6CreateFile failed: {}",
            std::io::Error::last_os_error()
        );
    }
    let handle = IcmpHandle(handle);

    let source = SOCKADDR_IN6 {
        sin6_family: AF_INET6,
        ..Default::default()
    };
    let mut destination = SOCKADDR_IN6 {
        sin6_family: AF_INET6,
        ..Default::default()
    };
    destination.sin6_addr.u.Byte = target.octets();

    // Same shape as the v4 buffer, around the v6 reply struct.
    let mut reply = vec![0u8; std::mem::size_of::<ICMPV6_ECHO_REPLY_LH>() + PAYLOAD.len() + 8];
    let timeout = u32::try_from(timeout_ms).unwrap_or(u32::MAX);

    // A null event and APC routine is what makes this synchronous; the return
    // value is then the reply count rather than a completion signal.
    let replies = unsafe {
        Icmp6SendEcho2(
            handle.0,
            std::ptr::null_mut(),
            None,
            std::ptr::null(),
            &source,
            &destination,
            PAYLOAD.as_ptr().cast(),
            PAYLOAD.len() as u16,
            std::ptr::null(),
            reply.as_mut_ptr().cast(),
            reply.len() as u32,
            timeout,
        )
    };

    if replies == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(IP_REQ_TIMED_OUT as i32) {
            anyhow::bail!("Timeout");
        }
        anyhow::bail!("Icmp6SendEcho2 failed: {error}");
    }

    let echo = unsafe {
        reply
            .as_ptr()
            .cast::<ICMPV6_ECHO_REPLY_LH>()
            .read_unaligned()
    };

    match echo.Status {
        IP_SUCCESS => Ok(u64::from(echo.RoundTripTime)),
        IP_REQ_TIMED_OUT => anyhow::bail!("Timeout"),
        status => anyhow::bail!("ICMPv6 status {status}"),
    }
}
