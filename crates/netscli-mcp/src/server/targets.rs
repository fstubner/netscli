//! Which hosts an MCP client is allowed to point the scanner at.
//!
//! Every other surface of netscli is driven by the person sitting in front
//! of it. This one is driven by a model, which may be reading a web page, an
//! issue comment, or a file that someone else wrote — so the instruction to
//! scan a third party can arrive from outside the operator entirely, and the
//! packets leave from the operator's machine and IP.
//!
//! The size limits elsewhere in this crate bound how *much* a client can
//! scan. Nothing bounded *what*. `validate_subnet` checks that a range is no
//! larger than a /16; a /16 of someone else's address space is still a /16.
//!
//! So the default target set is the local networks, and reaching past them
//! is an explicit choice the operator makes when they start the server:
//!
//! ```text
//! NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1 netscli serve
//! ```
//!
//! This is a policy layer, not a security boundary. It stops a model being
//! *steered* into scanning strangers; it does not stop the person running
//! the server, who could simply set the variable — and should be able to,
//! because scanning your own public hosts is a legitimate use.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use ipnet::Ipv4Net;

use super::errors::RpcError;

/// Environment variable that opts out of the local-only default.
pub(super) const ALLOW_PUBLIC_ENV: &str = "NETSCLI_MCP_ALLOW_PUBLIC_TARGETS";

fn public_targets_allowed() -> bool {
    match std::env::var(ALLOW_PUBLIC_ENV) {
        Ok(value) => {
            let value = value.trim().to_ascii_lowercase();
            matches!(value.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => false,
    }
}

/// Addresses reachable without the opt-in: the ones that belong to the
/// network the operator is on.
pub(super) fn is_local_scope(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_local_v4(v4),
        IpAddr::V6(v6) => is_local_v6(v6),
    }
}

fn is_local_v4(ip: Ipv4Addr) -> bool {
    // `is_shared` (100.64/10, carrier-grade NAT) is still unstable, and it
    // matters here: Tailscale and similar overlays hand out addresses from
    // it, so a user's own mesh would otherwise need the opt-in.
    let is_cgnat = ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]);
    ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || is_cgnat
}

fn is_local_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    // `is_unique_local` and `is_unicast_link_local` are unstable, so the
    // prefixes are matched directly: fc00::/7 and fe80::/10.
    let is_unique_local = (segments[0] & 0xfe00) == 0xfc00;
    let is_link_local = (segments[0] & 0xffc0) == 0xfe80;
    ip.is_loopback() || ip.is_unspecified() || is_unique_local || is_link_local
}

fn refusal(target: &str) -> RpcError {
    RpcError::InvalidParams(format!(
        "{target} is outside the local network. This server only scans local \
         targets unless it is started with {ALLOW_PUBLIC_ENV}=1."
    ))
}

/// Gate a single resolved address.
pub(super) fn ensure_ip_allowed(ip: IpAddr, shown_as: &str) -> Result<(), RpcError> {
    if public_targets_allowed() || is_local_scope(ip) {
        return Ok(());
    }
    Err(refusal(shown_as))
}

/// Gate a subnet by its network address.
///
/// The size cap runs separately, so by the time this is reached the range is
/// at most a /16 and its first address settles which side of the policy the
/// whole range falls on.
pub(super) fn ensure_subnet_allowed(net: &Ipv4Net, shown_as: &str) -> Result<(), RpcError> {
    ensure_ip_allowed(IpAddr::V4(net.network()), shown_as)
}

/// Gate a host that may be a name rather than an address.
///
/// A literal is checked directly. A name has to be resolved first, which is
/// why this is async: the policy is about where packets go, and only the
/// resolved address answers that.
pub(super) async fn ensure_host_allowed(host: &str, dns_timeout_ms: u64) -> Result<(), RpcError> {
    if public_targets_allowed() {
        return Ok(());
    }
    let host = host.trim();
    if let Ok(ip) = host.parse::<IpAddr>() {
        return ensure_ip_allowed(ip, host);
    }
    let ip = netscli_core::resolve_host_ip_with_timeout(host, dns_timeout_ms)
        .await
        .map_err(|e| RpcError::ToolError(e.to_string()))?;
    ensure_ip_allowed(ip, &format!("{host} ({ip})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_ranges_are_allowed_without_the_opt_in() {
        for ip in [
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.1",
            "127.0.0.1",
            "169.254.1.1",
            "100.100.1.1", // tailscale-style CGNAT
            "::1",
            "fd00::1",
            "fe80::1",
        ] {
            let parsed: IpAddr = ip.parse().unwrap();
            assert!(is_local_scope(parsed), "{ip} should be local");
        }
    }

    #[test]
    fn public_addresses_are_not_local() {
        for ip in [
            "8.8.8.8",
            "198.51.100.7", // TEST-NET-2, reserved but still not local
            "172.32.0.1",   // just past the RFC1918 /12
            "100.128.0.1",  // just past the CGNAT /10
            "2606:4700::1", // cloudflare
        ] {
            let parsed: IpAddr = ip.parse().unwrap();
            assert!(!is_local_scope(parsed), "{ip} should not be local");
        }
    }

    #[test]
    fn a_public_subnet_is_refused_by_the_network_address() {
        let net: Ipv4Net = "198.51.100.0/24".parse().unwrap();
        assert!(ensure_subnet_allowed(&net, "198.51.100.0/24").is_err());

        let net: Ipv4Net = "192.168.1.0/24".parse().unwrap();
        assert!(ensure_subnet_allowed(&net, "192.168.1.0/24").is_ok());
    }
}
