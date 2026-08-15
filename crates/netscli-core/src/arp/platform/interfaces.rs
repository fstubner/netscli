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

/// Match an address to the adapter prefix that actually contains it.
///
/// This used to take the *first* prefix of the same family, whatever it was
/// (B-37). Windows reports one prefix entry per network on the adapter, so a
/// multi-homed adapter — say 192.168.1.5/24 alongside 10.0.0.5/8 — had both
/// of its addresses reported with the first mask, and one of them was simply
/// wrong. Anything deriving a subnet from that then scanned the wrong range.
///
/// `common/network.rs` documents this exact hazard and defends against it for
/// the default-route lookup; the defence was never applied here.
///
/// The longest match wins, since Windows also reports the containing
/// supernet, and falls back to a host route rather than guessing a mask.
#[cfg(windows)]
fn ipnet_from_adapter(ip: IpAddr, prefixes: &[(IpAddr, u32)]) -> Option<IpNet> {
    let host_len = if ip.is_ipv4() { 32u32 } else { 128u32 };

    let prefix_len = prefixes
        .iter()
        .filter(|(prefix_ip, _)| prefix_ip.is_ipv4() == ip.is_ipv4())
        .filter(|(prefix_ip, len)| {
            // A /0 default entry matches everything and tells us nothing
            // about this address's subnet, so it is not a useful answer.
            *len > 0
                && IpNet::new(*prefix_ip, (*len).min(host_len) as u8)
                    .map(|net| net.contains(&ip))
                    .unwrap_or(false)
        })
        .map(|(_, len)| *len)
        .max()
        .unwrap_or(host_len);

    IpNet::new(ip, prefix_len.min(host_len) as u8).ok()
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

// `ipnet_from_adapter` is Windows-only, so the Linux and macOS CI runners
// never compile it, let alone exercise it. The matching logic is pure and
// platform-independent, so it is duplicated here as a testable function and
// asserted to agree with the real one on Windows -- otherwise the B-37 fix
// would be verified on exactly one of the three platforms we ship.
#[cfg(test)]
mod tests {
    use super::*;

    /// Mirror of `ipnet_from_adapter`'s selection rule, compiled everywhere.
    fn select_prefix_len(ip: IpAddr, prefixes: &[(IpAddr, u32)]) -> u32 {
        let host_len = if ip.is_ipv4() { 32u32 } else { 128u32 };
        prefixes
            .iter()
            .filter(|(prefix_ip, _)| prefix_ip.is_ipv4() == ip.is_ipv4())
            .filter(|(prefix_ip, len)| {
                *len > 0
                    && IpNet::new(*prefix_ip, (*len).min(host_len) as u8)
                        .map(|net| net.contains(&ip))
                        .unwrap_or(false)
            })
            .map(|(_, len)| *len)
            .max()
            .unwrap_or(host_len)
    }

    fn v4(s: &str) -> IpAddr {
        s.parse().expect("valid v4")
    }

    // The actual B-37 failure: one adapter, two networks. Taking the first
    // same-family prefix gave both addresses the same (wrong) mask.
    #[test]
    fn multi_homed_adapter_matches_each_address_to_its_own_prefix() {
        let prefixes = vec![(v4("192.168.1.0"), 24), (v4("10.0.0.0"), 8)];

        assert_eq!(select_prefix_len(v4("192.168.1.5"), &prefixes), 24);
        assert_eq!(select_prefix_len(v4("10.0.0.5"), &prefixes), 8);
    }

    // Prefix order must not decide the answer.
    #[test]
    fn prefix_order_does_not_change_the_result() {
        let forward = vec![(v4("192.168.1.0"), 24), (v4("10.0.0.0"), 8)];
        let reversed = vec![(v4("10.0.0.0"), 8), (v4("192.168.1.0"), 24)];

        for ip in ["192.168.1.5", "10.0.0.5"] {
            assert_eq!(
                select_prefix_len(v4(ip), &forward),
                select_prefix_len(v4(ip), &reversed),
                "prefix ordering changed the mask for {ip}",
            );
        }
    }

    // Windows reports the containing supernet too; the specific one wins.
    #[test]
    fn longest_matching_prefix_wins() {
        let prefixes = vec![(v4("10.0.0.0"), 8), (v4("10.1.2.0"), 24)];
        assert_eq!(select_prefix_len(v4("10.1.2.7"), &prefixes), 24);
    }

    // A /0 matches everything and says nothing about the subnet.
    #[test]
    fn default_route_prefix_is_ignored() {
        let prefixes = vec![(v4("0.0.0.0"), 0)];
        assert_eq!(select_prefix_len(v4("192.168.1.5"), &prefixes), 32);
    }

    // No covering prefix must not silently borrow an unrelated one.
    #[test]
    fn falls_back_to_a_host_route_when_nothing_contains_the_address() {
        let prefixes = vec![(v4("172.16.0.0"), 12)];
        assert_eq!(select_prefix_len(v4("192.168.1.5"), &prefixes), 32);
        assert_eq!(select_prefix_len(v4("192.168.1.5"), &[]), 32);
    }

    #[test]
    fn v6_addresses_ignore_v4_prefixes() {
        let mixed: Vec<(IpAddr, u32)> = vec![
            (v4("192.168.1.0"), 24),
            ("fd00::".parse().expect("valid v6"), 64),
        ];
        let ip: IpAddr = "fd00::5".parse().expect("valid v6");
        assert_eq!(select_prefix_len(ip, &mixed), 64);
    }

    // Keeps the mirror above honest: if the real function's rule changes,
    // this fails on Windows rather than the tests quietly testing a copy.
    #[cfg(windows)]
    #[test]
    fn mirror_matches_the_real_selection() {
        let prefixes = vec![(v4("192.168.1.0"), 24), (v4("10.0.0.0"), 8)];
        for ip in ["192.168.1.5", "10.0.0.5", "172.16.0.1"] {
            let addr = v4(ip);
            let expected = IpNet::new(addr, select_prefix_len(addr, &prefixes) as u8).ok();
            assert_eq!(ipnet_from_adapter(addr, &prefixes), expected, "for {ip}");
        }
    }
}
