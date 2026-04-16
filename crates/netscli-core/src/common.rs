use anyhow::{anyhow, Context, Result};
use ipnet::Ipv4Net;
#[cfg(not(windows))]
use ipnetwork::IpNetwork;

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
            .map_err(|_| anyhow!("invalid port in range: '{start_trim}'"))?;
        let e: u16 = end_trim
            .parse()
            .map_err(|_| anyhow!("invalid port in range: '{end_trim}'"))?;
        if s > e {
            return Err(anyhow!("inverted port range: {s}-{e}"));
        }
        Ok((s..=e).collect())
    } else {
        let port: u16 = part
            .parse()
            .map_err(|_| anyhow!("invalid port: '{part}'"))?;
        Ok(vec![port])
    }
}

/// Strict parser for user input — rejects any malformed token instead of
/// silently discarding it. `Some(None)` means the input was absent/empty;
/// `Err` means the user typed something that couldn't be interpreted.
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
        let mut expanded =
            parse_port_token(part).with_context(|| format!("Invalid port list: {raw}"))?;
        ports.append(&mut expanded);
    }
    if ports.is_empty() {
        return Err(anyhow!("Invalid port list: {raw}"));
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
    use std::net::IpAddr;

    let adapters = ipconfig::get_adapters().ok()?;
    for adapter in adapters {
        if adapter.oper_status() != OperStatus::IfOperStatusUp {
            continue;
        }
        if adapter.if_type() == IfType::SoftwareLoopback {
            continue;
        }
        for (prefix, len) in adapter.prefixes() {
            if let IpAddr::V4(v4) = *prefix {
                let prefix_len = (*len).min(32) as u8;
                if let Ok(net) = Ipv4Net::new(v4, prefix_len) {
                    return Some(net);
                }
            }
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
}
