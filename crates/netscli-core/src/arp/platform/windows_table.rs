//! The Windows neighbor table, read with `GetIpNetTable2` instead of running
//! `arp -a`.
//!
//! Discovery reads this table on every run. `arp -a` took 65 ms on an idle
//! Windows 11 machine but about 4 s on the same machine under heavy CPU load
//! (measured 2026-10-01). The API returns the same table in-process, with
//! no program to start.
//!
//! Only entries for a real neighbor are kept: reachable, stale, delay, probe
//! or permanent states, with a unicast MAC. `arp -a` also lists the subnet
//! broadcast address (ff-ff-ff-ff-ff-ff, "static") and multicast groups
//! (01-00-5e-...). Discovery used to report the broadcast address as a host.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use mac_address::MacAddress;
use windows_sys::Win32::Foundation::NO_ERROR;
use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIpNetTable2, GetUnicastIpAddressTable, MIB_IPNET_TABLE2,
    MIB_UNICASTIPADDRESS_TABLE,
};
use windows_sys::Win32::Networking::WinSock::{
    NlnsDelay, NlnsPermanent, NlnsProbe, NlnsReachable, NlnsStale, AF_INET, AF_INET6,
    NL_NEIGHBOR_STATE, SOCKADDR_INET,
};

use crate::arp::types::ArpEntry;
use crate::error::{Error, Result};
use crate::oui::lookup_vendor;

pub(super) fn read() -> Result<Vec<ArpEntry>> {
    let interfaces = interface_ipv4_by_index();
    let mut table: *mut MIB_IPNET_TABLE2 = std::ptr::null_mut();
    // SAFETY: GetIpNetTable2 allocates the table and writes its pointer.
    // IPv4 only, like `arp -a` here and the Linux and macOS tables.
    let status = unsafe { GetIpNetTable2(AF_INET, &mut table) };
    if status != NO_ERROR || table.is_null() {
        return Err(Error::Network(format!("GetIpNetTable2 failed: {status}")));
    }
    // SAFETY: on success `table` points at NumEntries rows; freed below.
    let rows = unsafe {
        std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
    };
    let mut entries = Vec::new();
    for row in rows {
        if row.PhysicalAddressLength != 6 {
            continue;
        }
        let bytes: [u8; 6] = row.PhysicalAddress[..6].try_into().unwrap_or([0; 6]);
        if !is_neighbor(row.State, bytes) {
            continue;
        }
        let Some(ip) = sockaddr_ip(&row.Address) else {
            continue;
        };
        let mac = MacAddress::new(bytes);
        let vendor = lookup_vendor(&mac.to_string());
        let interface = interfaces
            .get(&row.InterfaceIndex)
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| format!("if{}", row.InterfaceIndex));
        entries.push(ArpEntry {
            ip,
            mac,
            interface,
            vendor,
        });
    }
    // SAFETY: allocated by GetIpNetTable2.
    unsafe { FreeMibTable(table as *const _) };
    Ok(entries)
}

/// A row worth reporting: a state that means a real neighbor, and a unicast
/// MAC. All zeros is an unresolved entry, and the low bit of the first octet
/// marks broadcast (ff:ff:ff:ff:ff:ff) and multicast (01:00:5e:...).
fn is_neighbor(state: NL_NEIGHBOR_STATE, mac: [u8; 6]) -> bool {
    const LIVE: [NL_NEIGHBOR_STATE; 5] = [
        NlnsReachable,
        NlnsStale,
        NlnsDelay,
        NlnsProbe,
        NlnsPermanent,
    ];
    LIVE.contains(&state) && mac != [0; 6] && mac[0] & 1 == 0
}

/// Each interface's first IPv4 address, so entries keep the `interface`
/// value `arp -a` gave them (its "Interface: 192.168.1.10" header).
fn interface_ipv4_by_index() -> HashMap<u32, Ipv4Addr> {
    let mut map = HashMap::new();
    let mut table: *mut MIB_UNICASTIPADDRESS_TABLE = std::ptr::null_mut();
    // SAFETY: as for GetIpNetTable2.
    let status = unsafe { GetUnicastIpAddressTable(AF_INET, &mut table) };
    if status != NO_ERROR || table.is_null() {
        return map;
    }
    // SAFETY: on success `table` points at NumEntries rows; freed below.
    let rows = unsafe {
        std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
    };
    for row in rows {
        if let Some(IpAddr::V4(ip)) = sockaddr_ip(&row.Address) {
            map.entry(row.InterfaceIndex).or_insert(ip);
        }
    }
    // SAFETY: allocated by GetUnicastIpAddressTable.
    unsafe { FreeMibTable(table as *const _) };
    map
}

fn sockaddr_ip(addr: &SOCKADDR_INET) -> Option<IpAddr> {
    // SAFETY: si_family says which union member is valid.
    unsafe {
        match addr.si_family {
            AF_INET => {
                let raw = addr.Ipv4.sin_addr.S_un.S_addr;
                Some(IpAddr::V4(Ipv4Addr::from(u32::from_be(raw))))
            }
            AF_INET6 => Some(IpAddr::V6(Ipv6Addr::from(addr.Ipv6.sin6_addr.u.Byte))),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Networking::WinSock::{NlnsIncomplete, NlnsUnreachable};

    const UNICAST: [u8; 6] = [0x2c, 0xcf, 0x67, 0x26, 0xff, 0x96];

    #[test]
    fn a_live_unicast_neighbor_is_kept() {
        assert!(is_neighbor(NlnsReachable, UNICAST));
        assert!(is_neighbor(NlnsStale, UNICAST));
        assert!(is_neighbor(NlnsPermanent, UNICAST));
    }

    #[test]
    fn the_broadcast_and_multicast_entries_are_not_hosts() {
        // `arp -a` lists x.x.x.255 as ff-ff-ff-ff-ff-ff "static"; discovery
        // reported it as a host.
        assert!(!is_neighbor(NlnsPermanent, [0xff; 6]));
        assert!(!is_neighbor(
            NlnsPermanent,
            [0x01, 0x00, 0x5e, 0x00, 0x00, 0xfb]
        ));
    }

    #[test]
    fn unresolved_entries_are_not_hosts() {
        assert!(!is_neighbor(NlnsUnreachable, UNICAST));
        assert!(!is_neighbor(NlnsIncomplete, UNICAST));
        assert!(!is_neighbor(NlnsReachable, [0; 6]));
    }

    #[test]
    fn the_table_reads_and_includes_no_broadcast_entry() {
        let entries = read().expect("GetIpNetTable2");
        assert!(entries.iter().all(|e| e.mac.bytes() != [0xff; 6]));
    }
}
