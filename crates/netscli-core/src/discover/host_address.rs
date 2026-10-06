use ipnet::Ipv4Net;

/// An address in `subnet` that a device can hold: not the network address
/// and not the broadcast address, except on /31 and /32 where every address
/// is usable. The Windows neighbour table lists x.x.x.255
/// (ff:ff:ff:ff:ff:ff), and discovery reported it as a host.
pub(super) fn is_host_address(subnet: &Ipv4Net, ip: std::net::Ipv4Addr) -> bool {
    subnet.contains(&ip)
        && (subnet.prefix_len() >= 31 || (ip != subnet.network() && ip != subnet.broadcast()))
}

#[cfg(test)]
mod tests {
    use super::is_host_address;

    #[test]
    fn network_and_broadcast_are_not_hosts() {
        let net = "192.168.1.0/24".parse().unwrap();
        assert!(!is_host_address(&net, "192.168.1.0".parse().unwrap()));
        assert!(!is_host_address(&net, "192.168.1.255".parse().unwrap()));
        assert!(is_host_address(&net, "192.168.1.1".parse().unwrap()));
        assert!(is_host_address(&net, "192.168.1.254".parse().unwrap()));
        assert!(!is_host_address(&net, "192.168.2.1".parse().unwrap()));
    }

    #[test]
    fn every_address_counts_on_a_31_or_32() {
        let p2p = "10.0.0.0/31".parse().unwrap();
        assert!(is_host_address(&p2p, "10.0.0.0".parse().unwrap()));
        assert!(is_host_address(&p2p, "10.0.0.1".parse().unwrap()));
        let single = "10.0.0.5/32".parse().unwrap();
        assert!(is_host_address(&single, "10.0.0.5".parse().unwrap()));
    }
}
