mod platform;
mod types;

use std::net::IpAddr;

use mac_address::MacAddress;

use crate::error::Result;

pub use types::{ArpEntry, InterfaceInfo};

pub struct NetworkManager;

impl NetworkManager {
    pub fn find_mac(ip: &IpAddr) -> Option<ArpEntry> {
        let table = Self::get_arp_table().ok()?;
        table.into_iter().find(|e| &e.ip == ip)
    }

    pub fn get_interfaces() -> Vec<InterfaceInfo> {
        platform::get_interfaces()
    }

    pub fn get_arp_table() -> Result<Vec<ArpEntry>> {
        platform::get_arp_table()
    }

    pub fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
        platform::add_entry(ip, mac)
    }

    pub fn delete_entry(ip: IpAddr) -> Result<()> {
        platform::delete_entry(ip)
    }

    pub fn clear_table() -> Result<()> {
        platform::clear_table()
    }
}
