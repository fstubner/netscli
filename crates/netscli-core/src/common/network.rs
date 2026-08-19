use ipnet::Ipv4Net;
#[cfg(not(windows))]
use ipnetwork::IpNetwork;

use super::constants::DEFAULT_SUBNET;

#[cfg(not(windows))]
pub fn detect_default_ipv4_subnet() -> Option<Ipv4Net> {
    // Prefer non-tunnel interfaces (vpn/wireguard adapters often sort first
    // on laptops, and scanning the VPN subnet is almost never what the user
    // wants). We iterate ALL qualifying interfaces and return the first one
    // that actually has an IPv4 address — skipping IPv6-only interfaces that
    // would otherwise fail silently.
    let mut interfaces: Vec<_> = pnet_datalink::interfaces()
        .into_iter()
        .filter(|i| i.is_up() && !i.is_loopback())
        .collect();
    interfaces.sort_by_key(|i| interface_preference_rank(&i.name));

    for iface in interfaces {
        for ip in iface.ips {
            if let IpNetwork::V4(v4) = ip {
                if let Ok(net) = Ipv4Net::new(v4.ip(), v4.prefix()) {
                    // `.trunc()` drops any host bits so we return the network
                    // address regardless of whether the interface IP is a host.
                    return Some(net.trunc());
                }
            }
        }
    }

    None
}

/// Lower rank = more preferred. Tunnel/VPN interfaces are pushed to the back
/// so ordinary ethernet/wifi wins on multi-adapter hosts.
#[cfg(not(windows))]
fn interface_preference_rank(name: &str) -> u8 {
    const TUNNEL_PREFIXES: &[&str] = &["tun", "tap", "wg", "utun", "zt", "ppp", "gif", "ipsec"];
    // Lowercase once per call rather than per-comparison.
    let lowered = name.to_ascii_lowercase();
    if TUNNEL_PREFIXES.iter().any(|p| lowered.starts_with(p)) {
        2
    } else {
        0
    }
}

#[cfg(windows)]
pub fn detect_default_ipv4_subnet() -> Option<Ipv4Net> {
    use ipconfig::{IfType, OperStatus};

    let adapters = ipconfig::get_adapters().ok()?;
    for adapter in adapters {
        if adapter.oper_status() != OperStatus::IfOperStatusUp {
            continue;
        }
        if adapter.if_type() == IfType::SoftwareLoopback {
            continue;
        }
        if let Some(net) = pick_ipv4_subnet_from_prefixes(adapter.prefixes()) {
            return Some(net);
        }
    }

    None
}

/// Pick the first network-shaped IPv4 subnet from a Windows adapter's
/// prefix list.
///
/// `ipconfig::Adapter::prefixes()` returns ALL prefixes the OS knows for
/// the adapter — that includes the host's own /32 (e.g., 192.168.1.42/32),
/// broadcast /32 (192.168.1.255/32), multicast (224.0.0.0/4), link-local
/// (169.254.0.0/16), and the limited-broadcast /32 (255.255.255.255/32),
/// in addition to the actual network prefix we want (e.g., 192.168.1.0/24).
#[cfg(any(windows, test))]
fn pick_ipv4_subnet_from_prefixes(prefixes: &[(std::net::IpAddr, u32)]) -> Option<Ipv4Net> {
    use std::net::IpAddr;

    for &(prefix, len) in prefixes {
        let IpAddr::V4(v4) = prefix else { continue };
        if !(1..=30).contains(&len) {
            continue;
        }
        let octets = v4.octets();
        // Multicast (224.0.0.0/4) and reserved (240.0.0.0/4).
        if octets[0] >= 224 {
            continue;
        }
        // Link-local autoconf range (169.254.0.0/16).
        if octets[0] == 169 && octets[1] == 254 {
            continue;
        }
        let prefix_len = len as u8;
        if let Ok(net) = Ipv4Net::new(v4, prefix_len) {
            // `.trunc()` masks any host bits in `v4` so callers always see
            // the network address (matching the non-Windows code path).
            return Some(net.trunc());
        }
    }

    None
}

#[cfg(not(windows))]
pub fn detect_default_ipv4_addr() -> Option<std::net::Ipv4Addr> {
    let iface = pnet_datalink::interfaces()
        .into_iter()
        .find(|i| i.is_up() && !i.is_loopback())?;

    for ip in iface.ips {
        if let IpNetwork::V4(v4) = ip {
            return Some(v4.ip());
        }
    }

    None
}

#[cfg(windows)]
pub fn detect_default_ipv4_addr() -> Option<std::net::Ipv4Addr> {
    use ipconfig::{IfType, OperStatus};
    use std::net::IpAddr;

    let adapters = ipconfig::get_adapters().ok()?;
    for adapter in adapters {
        if adapter.oper_status() != OperStatus::IfOperStatusUp {
            continue;
        }
        if adapter.if_type() == IfType::SoftwareLoopback {
            continue;
        }
        for ip in adapter.ip_addresses() {
            if let IpAddr::V4(v4) = *ip {
                return Some(v4);
            }
        }
    }

    None
}

/// Prefix the default narrows to when the interface's own is wider than the
/// safety cap. A /24 is the range a person means by "my network".
const NARROWED_DEFAULT_PREFIX: u8 = 24;

pub fn default_ipv4_subnet_string() -> String {
    let Some(net) = detect_default_ipv4_subnet() else {
        return DEFAULT_SUBNET.to_string();
    };

    // An interface legitimately carrying a /8 -- a 10.0.0.0/8 corporate
    // network, or Docker -- produced a default that the /16 cap then
    // refused, so the *no-arguments* call failed with "subnet too large".
    // That is the first call anything makes. Narrow to the /24 around this
    // host instead of handing back a range that cannot be scanned.
    if net.prefix_len() >= 16 {
        return format!("{}/{}", net.network(), net.prefix_len());
    }
    match detect_default_ipv4_addr()
        .and_then(|addr| Ipv4Net::new(addr, NARROWED_DEFAULT_PREFIX).ok())
    {
        Some(narrowed) => format!("{}/{}", narrowed.network(), narrowed.prefix_len()),
        None => DEFAULT_SUBNET.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn v4(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    #[test]
    fn pick_subnet_skips_host_slash_32_takes_network_slash_24() {
        // Typical Windows ordering: the host's own /32 comes before the
        // network /24. Without filtering the bug hits — `discover_ipv4`
        // would scan exactly one IP and return only the local machine.
        let prefixes = [
            (v4(192, 168, 1, 42), 32u32), // host
            (v4(192, 168, 1, 0), 24),     // network — what we want
            (v4(192, 168, 1, 255), 32),   // broadcast
            (v4(224, 0, 0, 0), 4),        // multicast
            (v4(255, 255, 255, 255), 32), // limited broadcast
        ];
        let net = pick_ipv4_subnet_from_prefixes(&prefixes).expect("must pick a subnet");
        assert_eq!(net.to_string(), "192.168.1.0/24");
    }

    #[test]
    fn pick_subnet_skips_multicast_and_link_local() {
        // If the only available "real" prefix is preceded by multicast
        // and link-local entries, we should still find the right one.
        let prefixes = [
            (v4(224, 0, 0, 0), 4),
            (v4(169, 254, 0, 0), 16),
            (v4(10, 0, 0, 0), 8),
        ];
        let net = pick_ipv4_subnet_from_prefixes(&prefixes).expect("must pick a subnet");
        assert_eq!(net.to_string(), "10.0.0.0/8");
    }

    #[test]
    fn pick_subnet_truncates_host_bits() {
        // If Windows hands back a tuple with host bits set in the address
        // (rare but possible across vendor stacks), we should still return
        // the network address rather than a malformed Ipv4Net.
        let prefixes = [(v4(192, 168, 1, 42), 24u32)];
        let net = pick_ipv4_subnet_from_prefixes(&prefixes).expect("must pick a subnet");
        assert_eq!(net.to_string(), "192.168.1.0/24");
    }

    #[test]
    fn pick_subnet_returns_none_when_no_usable_prefix() {
        // All host /32, multicast, link-local: nothing to scan.
        let prefixes = [
            (v4(192, 168, 1, 42), 32u32),
            (v4(224, 0, 0, 0), 4),
            (v4(169, 254, 12, 5), 16),
            (v4(255, 255, 255, 255), 32),
        ];
        assert!(pick_ipv4_subnet_from_prefixes(&prefixes).is_none());
    }

    #[test]
    fn pick_subnet_skips_slash_31_and_zero() {
        // /31 has only 2 IPs and no broadcast (RFC 3021 point-to-point);
        // not a useful "discover" target. /0 is the entire IPv4 space and
        // would be rejected by `ensure_subnet_limit` later anyway, but
        // skip it here too so we don't return something obviously wrong.
        let prefixes = [
            (v4(10, 0, 0, 0), 0u32),
            (v4(10, 0, 0, 0), 31),
            (v4(10, 0, 0, 0), 30),
        ];
        let net = pick_ipv4_subnet_from_prefixes(&prefixes).expect("must pick /30");
        assert_eq!(net.to_string(), "10.0.0.0/30");
    }
}
