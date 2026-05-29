use ipnet::IpNet;
use mac_address::MacAddress;
use serde::Serialize;
use std::net::IpAddr;

#[derive(Debug, Clone, Serialize)]
pub struct ArpEntry {
    pub ip: IpAddr,
    pub mac: MacAddress,
    pub interface: String,
    pub vendor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InterfaceInfo {
    pub name: String,
    pub mac: Option<MacAddress>,
    pub ips: Vec<IpNet>,
    pub is_up: bool,
    pub is_loopback: bool,
}
