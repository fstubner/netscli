use ipnet::IpNet;
use mac_address::MacAddress;
use serde::Serialize;
use std::net::IpAddr;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct ArpEntry {
    pub ip: IpAddr,
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    pub mac: MacAddress,
    pub interface: String,
    pub vendor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct InterfaceInfo {
    pub name: String,
    #[cfg_attr(feature = "ts", ts(type = "string | null"))]
    pub mac: Option<MacAddress>,
    #[cfg_attr(feature = "ts", ts(type = "Array<string>"))]
    pub ips: Vec<IpNet>,
    pub is_up: bool,
    pub is_loopback: bool,
}
