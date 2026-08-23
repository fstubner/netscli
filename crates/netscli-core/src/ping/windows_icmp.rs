//! ICMP echo on Windows, via the IP Helper API.
//!
//! `IcmpSendEcho` is the platform's own ping primitive. It works without
//! administrator rights, which the raw path does not, and it reaches loopback
//! and any address this host owns. Both properties are load-bearing: see the
//! note on `send_icmp_echo_v4` for the failure each one fixes.

use std::net::IpAddr;
use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
use windows_sys::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, IP_REQ_TIMED_OUT, IP_SUCCESS,
};

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
