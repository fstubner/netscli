//! Ask a neighbour to answer ARP now, rather than trusting the table.
//!
//! The neighbour table remembers devices that have since gone. Read straight
//! after a ping sweep it still held entries in the Stale, Delay and Probe
//! states for devices that no longer answered anything, and discovery
//! reported them as present: 4 of 26 hosts on one LAN (measured 2026-10-06),
//! every one of them failing three ARP lookups in a row afterwards.
//!
//! `SendARP` sends a fresh ARP request and blocks until a reply or Windows'
//! own retries run out, about 4 s for an address with nothing behind it. A
//! device that is there but ignores ping still answers ARP, so this keeps
//! the ICMP-silent devices the table is there to find and drops the ghosts.

use std::net::Ipv4Addr;

use windows_sys::Win32::NetworkManagement::IpHelper::SendARP;

/// The MAC `ip` answers ARP with, or `None` if nothing answered. Blocking.
pub(super) fn resolve(ip: Ipv4Addr) -> Option<[u8; 6]> {
    // Two ULONGs, as SendARP documents, which also gives the buffer a ULONG's
    // alignment. A byte array has none.
    let mut mac = [0u32; 2];
    let mut len = std::mem::size_of_val(&mac) as u32;
    // SendARP takes the address in network byte order as a u32.
    let dest = u32::from_ne_bytes(ip.octets());
    // SAFETY: an 8-byte buffer and its length; SendARP writes at most `len`.
    let status = unsafe { SendARP(dest, 0, mac.as_mut_ptr().cast(), &mut len) };
    if status != 0 || len != 6 {
        return None;
    }
    // The bytes as SendARP wrote them to memory.
    let [low, high] = mac.map(u32::to_ne_bytes);
    Some([low[0], low[1], low[2], low[3], high[0], high[1]])
}
