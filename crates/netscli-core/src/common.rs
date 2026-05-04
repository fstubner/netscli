use ipnet::Ipv4Net;
#[cfg(not(windows))]
use ipnetwork::IpNetwork;

use crate::error::{Error, Result};

pub const DEFAULT_SUBNET: &str = "192.168.1.0/24";
pub const DEFAULT_PORTS: &[u16] = &[22, 80, 443];
pub const DEFAULT_CONCURRENCY: usize = 256;
pub const DEFAULT_SCAN_TIMEOUT_MS: u64 = 500;
pub const DEFAULT_PING_TIMEOUT_MS: u64 = 1000;
pub const DEFAULT_DNS_TIMEOUT_MS: u64 = 1500;

/// Lenient parser used by internal defaults — silently drops invalid tokens.
/// Prefer `parse_ports_checked` for user input so typos are surfaced.
pub fn parse_ports(input: Option<&str>) -> Option<Vec<u16>> {
    input.map(|s| {
        s.split(',')
            .filter_map(|part| parse_port_token(part).ok())
            .flatten()
            .collect()
    })
}

fn parse_port_token(part: &str) -> Result<Vec<u16>> {
    let part = part.trim();
    if part.is_empty() {
        return Ok(Vec::new());
    }

    if let Some((start, end)) = part.split_once('-') {
        let start_trim = start.trim();
        let end_trim = end.trim();
        let s: u16 = start_trim
            .parse()
            .map_err(|_| Error::invalid_input(format!("invalid port in range: '{start_trim}'")))?;
        let e: u16 = end_trim
            .parse()
            .map_err(|_| Error::invalid_input(format!("invalid port in range: '{end_trim}'")))?;
        if s > e {
            return Err(Error::invalid_input(format!(
                "inverted port range: {s}-{e}"
            )));
        }
        Ok((s..=e).collect())
    } else {
        let port: u16 = part
            .parse()
            .map_err(|_| Error::invalid_input(format!("invalid port: '{part}'")))?;
        Ok(vec![port])
    }
}

/// Strict parser for user input — rejects any malformed token instead of
/// silently discarding it. `Some(None)` means the input was absent/empty;
/// `Err(Error::InvalidInput(..))` means the user typed something that
/// couldn't be interpreted.
pub fn parse_ports_checked(input: Option<&str>) -> Result<Option<Vec<u16>>> {
    let Some(raw) = input else {
        return Ok(None);
    };

    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }

    let mut ports = Vec::new();
    for part in raw.split(',') {
        let mut expanded = parse_port_token(part).map_err(|e| {
            // Wrap the inner parser's per-token message with the caller's
            // context so consumers see both "why" and "where" in one Error.
            Error::invalid_input(format!("Invalid port list '{raw}': {e}"))
        })?;
        ports.append(&mut expanded);
    }
    if ports.is_empty() {
        return Err(Error::invalid_input(format!("Invalid port list: {raw}")));
    }
    // Sort + dedup so downstream scanners don't probe the same port twice.
    ports.sort_unstable();
    ports.dedup();
    Ok(Some(ports))
}

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
///
/// Order in the returned list is OS-defined; Windows typically reports the
/// host /32 BEFORE the network /24, so picking the first IPv4 entry yields
/// a single-IP "subnet" and `discover` returns only the local machine.
///
/// Filter to entries that look like a network of multiple hosts:
///   - IPv4 only
///   - prefix length in [1, 30] — /32 is one host or broadcast, and /31
///     (RFC 3021 point-to-point) has only 2 IPs and is almost never the
///     intended target for "discover network"
///   - not multicast (first octet < 224)
///   - not link-local (169.254.0.0/16)
///
/// Then truncate so we return the network address regardless of whether
/// the prefix tuple's address had host bits set.
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

pub fn default_ipv4_subnet_string() -> String {
    detect_default_ipv4_subnet()
        .map(|n| format!("{}/{}", n.network(), n.prefix_len()))
        .unwrap_or_else(|| DEFAULT_SUBNET.to_string())
}

pub fn default_ports() -> Vec<u16> {
    DEFAULT_PORTS.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ports_single() {
        assert_eq!(parse_ports(Some("80")), Some(vec![80]));
        assert_eq!(parse_ports(Some("443")), Some(vec![443]));
    }

    #[test]
    fn test_parse_ports_comma_separated() {
        assert_eq!(parse_ports(Some("80,443,8080")), Some(vec![80, 443, 8080]));
        assert_eq!(parse_ports(Some("22,80,443")), Some(vec![22, 80, 443]));
    }

    #[test]
    fn test_parse_ports_range() {
        assert_eq!(parse_ports(Some("80-82")), Some(vec![80, 81, 82]));
        assert_eq!(parse_ports(Some("22-24")), Some(vec![22, 23, 24]));
    }

    #[test]
    fn test_parse_ports_mixed() {
        assert_eq!(
            parse_ports(Some("80,443,8080-8082")),
            Some(vec![80, 443, 8080, 8081, 8082])
        );
    }

    #[test]
    fn test_parse_ports_with_spaces() {
        assert_eq!(
            parse_ports(Some("80, 443, 8080")),
            Some(vec![80, 443, 8080])
        );
        assert_eq!(parse_ports(Some("80 - 82")), Some(vec![80, 81, 82]));
    }

    #[test]
    fn test_parse_ports_none() {
        assert_eq!(parse_ports(None), None);
    }

    #[test]
    fn test_parse_ports_invalid_lenient() {
        // Lenient `parse_ports` silently drops invalid tokens — that's
        // intentional for internal defaults. User input goes through
        // `parse_ports_checked` which is strict.
        assert_eq!(parse_ports(Some("invalid")), Some(vec![]));
        assert_eq!(parse_ports(Some("80,invalid,443")), Some(vec![80, 443]));
    }

    #[test]
    fn test_parse_ports_checked_invalid() {
        let err = parse_ports_checked(Some("invalid")).unwrap_err();
        assert!(err.to_string().contains("Invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_rejects_typo() {
        // Previously this silently returned [80,443]. Typos are now surfaced.
        let err = parse_ports_checked(Some("80,invalid,443")).unwrap_err();
        assert!(
            err.to_string().contains("Invalid port list"),
            "expected strict rejection, got: {err}"
        );
    }

    #[test]
    fn test_parse_ports_checked_rejects_out_of_range() {
        let err = parse_ports_checked(Some("22,99999")).unwrap_err();
        assert!(err.to_string().contains("Invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_rejects_inverted_range() {
        let err = parse_ports_checked(Some("90-80")).unwrap_err();
        assert!(err.to_string().contains("Invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_empty() {
        assert_eq!(parse_ports_checked(Some("  ")).unwrap(), None);
    }

    #[test]
    fn test_parse_ports_checked_sorts_and_dedupes() {
        assert_eq!(
            parse_ports_checked(Some("443,80,22,80,22")).unwrap(),
            Some(vec![22, 80, 443])
        );
    }

    #[test]
    fn test_parse_ports_checked_valid() {
        assert_eq!(
            parse_ports_checked(Some("80,443")).unwrap(),
            Some(vec![80, 443])
        );
    }

    // The helper for Windows subnet detection is `cfg(any(windows, test))`,
    // so its tests run on every platform's CI. Inputs mirror what
    // `ipconfig::Adapter::prefixes()` actually returns on Windows hosts.
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
