mod command;
mod interfaces;
mod mutate;
mod table;
#[cfg(target_os = "windows")]
mod windows_resolve;
#[cfg(target_os = "windows")]
mod windows_table;

use std::net::IpAddr;

use mac_address::MacAddress;

use super::types::{ArpEntry, InterfaceInfo};
use crate::error::Result;

pub(super) fn get_interfaces() -> Vec<InterfaceInfo> {
    interfaces::get_interfaces()
}

pub(super) fn get_arp_table() -> Result<Vec<ArpEntry>> {
    table::get_arp_table()
}

pub(super) fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
    mutate::add_entry(ip, mac)
}

pub(super) fn delete_entry(ip: IpAddr) -> Result<()> {
    mutate::delete_entry(ip)
}

pub(super) fn clear_table() -> Result<()> {
    mutate::clear_table()
}

/// Whether `ip` answers ARP right now. Blocking; see windows_resolve.rs.
#[cfg(target_os = "windows")]
pub(super) fn answers_arp(ip: std::net::Ipv4Addr) -> bool {
    windows_resolve::resolve(ip).is_some()
}
