//! The Windows neighbor table, read with `GetIpNetTable2` instead of running
//! `arp -a`.
//!
//! `arp -a` took about 4 s to return on a Windows 11 machine with a dozen
//! adapters (measured 2026-10-01), and discovery reads this table on every
//! run. The API returns the same table in-process.
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
    NlnsDelay, NlnsPermanent, NlnsProbe, NlnsReachable, NlnsStale, AF_INET, AF_INET6, AF_UNSPEC,
    SOCKADDR_INET,
};

use crate::arp::types::ArpEntry;
use crate::error::{Error, Result};
use crate::oui::lookup_vendor;

pub(super) fn read() -> Result<Vec<ArpEntry>> {
    let interfaces = interface_ipv4_by_index();
    let mut table: *mut MIB_IPNET_TABLE2 = std::ptr::null_mut();
    // SAFETY: GetIpNetTable2 allocates the table and writes its pointer.
    let status = unsafe { GetIpNetTable2(AF_UNSPEC, &mut table) };
    if status != NO_ERROR || table.is_null() {
        return Err(Error::Network(format!("GetIpNetTable2 failed: {status}")));
    }
    // SAFETY: on success `table` points at NumEntries rows; freed below.
    let rows = unsafe {
        std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
    };
    let mut entries = Vec::new();
    for row in rows {
        let live = matches!(
            row.State,
            NlnsReachable | NlnsStale | NlnsDelay | NlnsProbe | NlnsPermanent
        );
        if !live || row.PhysicalAddressLength != 6 {
            continue;
        }
        let bytes: [u8; 6] = row.PhysicalAddress[..6].try_into().unwrap_or([0; 6]);
        // All zeros is an unresolved entry. The low bit of the first octet
        // marks broadcast and multicast.
        if bytes == [0; 6] || bytes[0] & 1 == 1 {
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
