use ipnet::Ipv4Net;

use crate::error::{Error, Result};

const MAX_SUBNET_ADDRESSES: u64 = 1 << 16; // /16

pub(super) fn parse_limited_ipv4_subnet(subnet_str: &str) -> Result<Ipv4Net> {
    let net: Ipv4Net = subnet_str
        .parse()
        .map_err(|e| Error::invalid_input(format!("Invalid subnet format '{subnet_str}': {e}")))?;
    ensure_subnet_limit(&net, subnet_str)?;
    Ok(net)
}

/// Refuse a subnet larger than /16.
///
/// `pub(crate)` so the engines can enforce it too. It used to be private to
/// `ops`, which meant `DiscoverEngine::scan_subnet` and `SweepEngine::sweep`
/// -- both re-exported at the crate root -- materialised every address of
/// whatever `Ipv4Net` they were handed. `0.0.0.0/0` asks for a
/// 4,294,967,294-element `Vec<IpAddr>`, about 73 GB, before a single packet
/// is sent.
pub(crate) fn ensure_subnet_limit(net: &Ipv4Net, subnet_str: &str) -> Result<()> {
    let prefix = net.prefix_len() as u32;
    let host_bits = 32u32.saturating_sub(prefix);
    let total = 1u64.checked_shl(host_bits).unwrap_or(u64::MAX);
    if total > MAX_SUBNET_ADDRESSES {
        return Err(Error::invalid_input(format!(
            "subnet too large: {subnet_str} (max /16)"
        )));
    }
    Ok(())
}
