use ipnet::IpNet;
#[cfg(not(windows))]
use ipnetwork::IpNetwork;
use mac_address::MacAddress;
#[cfg(not(windows))]
use pnet_datalink;
use std::net::IpAddr;

use crate::arp::types::InterfaceInfo;

#[cfg(not(windows))]
pub(super) fn get_interfaces() -> Vec<InterfaceInfo> {
    pnet_datalink::interfaces()
        .into_iter()
        .map(|iface| {
            let name = iface.name.clone();
            let mac = iface.mac.map(|m| MacAddress::new(m.octets()));
            let is_up = iface.is_up();
            let is_loopback = iface.is_loopback();
            let ips = iface
                .ips
                .iter()
                .filter_map(|n| convert_ipnetwork(*n))
                .collect();
            InterfaceInfo {
                name,
                mac,
                ips,
                is_up,
                is_loopback,
            }
        })
        .collect()
}

#[cfg(windows)]
pub(super) fn get_interfaces() -> Vec<InterfaceInfo> {
    use ipconfig::{IfType, OperStatus};

    let adapters = match ipconfig::get_adapters() {
        Ok(adapters) => adapters,
        Err(_) => return Vec::new(),
    };

    adapters
        .into_iter()
        .map(|adapter| {
            let name = adapter.friendly_name().to_string();
            let mac = adapter.physical_address().and_then(mac_from_bytes);
            let is_up = adapter.oper_status() == OperStatus::IfOperStatusUp;
            let is_loopback = adapter.if_type() == IfType::SoftwareLoopback;
            let prefixes = adapter.prefixes();
            let ips = adapter
                .ip_addresses()
                .iter()
                .filter_map(|ip| ipnet_from_adapter(*ip, prefixes))
                .collect();
            InterfaceInfo {
                name,
                mac,
                ips,
                is_up,
                is_loopback,
            }
        })
        .collect()
}

#[cfg(not(windows))]
fn convert_ipnetwork(net: IpNetwork) -> Option<IpNet> {
    match net {
        IpNetwork::V4(v4) => IpNet::new(IpAddr::V4(v4.ip()), v4.prefix()).ok(),
        IpNetwork::V6(v6) => IpNet::new(IpAddr::V6(v6.ip()), v6.prefix()).ok(),
    }
}

#[cfg(windows)]
fn ipnet_from_adapter(ip: IpAddr, prefixes: &[(IpAddr, u32)]) -> Option<IpNet> {
    let prefix_len = prefixes
        .iter()
        .find(|(prefix_ip, _)| prefix_ip.is_ipv4() == ip.is_ipv4())
        .map(|(_, len)| *len)
        .unwrap_or_else(|| if ip.is_ipv4() { 32 } else { 128 });
    IpNet::new(ip, prefix_len.min(128) as u8).ok()
}

#[cfg(windows)]
fn mac_from_bytes(bytes: &[u8]) -> Option<MacAddress> {
    if bytes.len() == 6 {
        Some(MacAddress::new([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
        ]))
    } else {
        None
    }
}
