//! What `udp.rs` sends to each well-known UDP service, and how it reads
//! the reply for the banner column.

use crate::scan::probes::single_line_display;

/// Longest reply description kept. It is text a remote host chose.
const MAX_DESCRIPTION: usize = 120;

/// The request each well-known service answers. Anything else gets an empty
/// datagram, which some services answer and none should mind.
pub(super) fn probe_for(port: u16) -> &'static [u8] {
    match port {
        53 => DNS_ROOT_NS_QUERY,
        123 => &NTP_CLIENT_REQUEST,
        137 => NETBIOS_NODE_STATUS_QUERY,
        1900 => SSDP_SEARCH,
        5353 => MDNS_SERVICES_QUERY,
        _ => &[],
    }
}

/// A standard query for the root zone's NS records: every DNS server can
/// answer it, and it names nothing outside the network being scanned.
const DNS_ROOT_NS_QUERY: &[u8] = &[
    0x4e, 0x53, // id
    0x01, 0x00, // standard query, recursion desired
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 1 question
    0x00, // root name
    0x00, 0x02, // type NS
    0x00, 0x01, // class IN
];

/// An NTPv3 client request: mode 3, everything else zero.
const NTP_CLIENT_REQUEST: [u8; 48] = {
    let mut packet = [0u8; 48];
    packet[0] = 0x1b;
    packet
};

/// A NetBIOS node status (NBSTAT) query for `*`, which asks a Windows or
/// Samba host for its name table.
const NETBIOS_NODE_STATUS_QUERY: &[u8] = b"\x80\x94\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\
\x20CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x00\x00\x21\x00\x01";

/// A unicast SSDP search: UPnP devices answer with their SERVER string.
const SSDP_SEARCH: &[u8] = b"M-SEARCH * HTTP/1.1\r\n\
HOST: 239.255.255.250:1900\r\n\
MAN: \"ssdp:discover\"\r\n\
MX: 1\r\n\
ST: ssdp:all\r\n\r\n";

/// A legacy unicast mDNS query for the DNS-SD service list. Responders
/// answer a query from a port other than 5353 directly to the sender.
const MDNS_SERVICES_QUERY: &[u8] = &[
    0x4e, 0x44, // id (legacy unicast queries carry one)
    0x00, 0x00, // standard query
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 1 question
    9, b'_', b's', b'e', b'r', b'v', b'i', b'c', b'e', b's', //
    7, b'_', b'd', b'n', b's', b'-', b's', b'd', //
    4, b'_', b'u', b'd', b'p', //
    5, b'l', b'o', b'c', b'a', b'l', //
    0,    //
    0x00, 0x0c, // type PTR
    0x00, 0x01, // class IN
];

/// A one-line description of a reply, for the banner column. Every value in
/// it came from the scanned host, so it's collapsed to one terminal-safe
/// line and capped.
pub(super) fn describe_reply(port: u16, reply: &[u8]) -> Option<String> {
    let text = match port {
        53 => "DNS reply".to_string(),
        123 => describe_ntp(reply)?,
        137 => describe_netbios(reply)
            .map(|name| format!("NetBIOS name {name}"))
            .unwrap_or_else(|| "NetBIOS reply".to_string()),
        1900 => describe_ssdp(reply)
            .map(|server| format!("SSDP: {server}"))
            .unwrap_or_else(|| "SSDP reply".to_string()),
        5353 => "mDNS reply".to_string(),
        _ => format!("reply, {} bytes", reply.len()),
    };
    let line = single_line_display(&text);
    Some(line.chars().take(MAX_DESCRIPTION).collect())
}

/// `NTP v4, stratum 2`, from the first two bytes of a server reply.
fn describe_ntp(reply: &[u8]) -> Option<String> {
    if reply.len() < 48 {
        return None;
    }
    let version = (reply[0] >> 3) & 0x07;
    let stratum = reply[1];
    Some(format!("NTP v{version}, stratum {stratum}"))
}

/// The host's own name from a NetBIOS node status reply: the first unique
/// (non-group) name with suffix 0x00, which is the workstation name.
///
/// The reply repeats the 34-byte query name after the 12-byte header, then
/// type, class, TTL and length (10 bytes), so the name count is at byte 56
/// and each 18-byte entry is a 15-byte name, a suffix byte and two flag bytes.
fn describe_netbios(reply: &[u8]) -> Option<String> {
    const NAMES_AT: usize = 56;
    let count = *reply.get(NAMES_AT)? as usize;
    (0..count).find_map(|i| {
        let entry = reply.get(NAMES_AT + 1 + i * 18..NAMES_AT + 1 + (i + 1) * 18)?;
        let suffix = entry[15];
        let is_group = entry[16] & 0x80 != 0;
        if suffix != 0x00 || is_group {
            return None;
        }
        let name = String::from_utf8_lossy(&entry[..15]).trim_end().to_string();
        (!name.is_empty()).then_some(name)
    })
}

/// The SERVER header of an SSDP reply (`Linux/5.15 UPnP/1.0 MiniUPnPd/2.3`).
fn describe_ssdp(reply: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(reply);
    text.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("server")
            .then(|| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn well_known_ports_get_their_own_probe_and_others_an_empty_one() {
        assert_eq!(probe_for(53)[12..], [0x00, 0x00, 0x02, 0x00, 0x01]);
        assert_eq!(probe_for(123).len(), 48);
        assert_eq!(probe_for(123)[0], 0x1b);
        assert_eq!(probe_for(137).len(), 50);
        assert!(probe_for(1900).starts_with(b"M-SEARCH * HTTP/1.1\r\n"));
        assert!(probe_for(5353).len() > 12);
        assert!(probe_for(9999).is_empty());
    }

    #[test]
    fn an_ntp_reply_gives_its_version_and_stratum() {
        let mut reply = [0u8; 48];
        reply[0] = 0x24; // LI 0, version 4, mode 4 (server)
        reply[1] = 2;
        assert_eq!(describe_ntp(&reply).as_deref(), Some("NTP v4, stratum 2"));
        assert_eq!(describe_ntp(&reply[..10]), None);
    }

    fn netbios_reply(names: &[(&str, u8, u8)]) -> Vec<u8> {
        let mut reply = vec![0u8; 56];
        reply.push(names.len() as u8);
        for (name, suffix, flags) in names {
            let mut entry = format!("{name:<15}").into_bytes();
            entry.push(*suffix);
            entry.extend_from_slice(&[*flags, 0x00]);
            reply.extend(entry);
        }
        reply
    }

    #[test]
    fn a_netbios_reply_gives_the_workstation_name() {
        let reply = netbios_reply(&[
            ("WORKGROUP", 0x00, 0x80), // group name: skipped
            ("NAS", 0x20, 0x00),       // file server service: skipped
            ("NAS", 0x00, 0x00),       // the workstation name
        ]);
        assert_eq!(describe_netbios(&reply).as_deref(), Some("NAS"));
    }

    #[test]
    fn a_short_or_empty_netbios_reply_gives_no_name() {
        assert_eq!(describe_netbios(&[0u8; 20]), None);
        assert_eq!(describe_netbios(&netbios_reply(&[])), None);
        // Claims three names but carries one: stops at the end of the data.
        let mut reply = netbios_reply(&[("NAS", 0x20, 0x00)]);
        reply[56] = 3;
        assert_eq!(describe_netbios(&reply), None);
    }

    #[test]
    fn an_ssdp_reply_gives_its_server_string() {
        let reply = b"HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nSERVER: Linux/5.15 UPnP/1.0 MiniUPnPd/2.3\r\n\r\n";
        assert_eq!(
            describe_ssdp(reply).as_deref(),
            Some("Linux/5.15 UPnP/1.0 MiniUPnPd/2.3")
        );
    }

    #[test]
    fn a_reply_description_cannot_carry_control_characters_or_run_on() {
        let reply = format!(
            "HTTP/1.1 200 OK\r\nSERVER: evil\u{1b}[2J{}\r\n\r\n",
            "x".repeat(500)
        );
        let described = describe_reply(1900, reply.as_bytes()).unwrap();
        assert!(!described.chars().any(char::is_control));
        assert_eq!(described.chars().count(), MAX_DESCRIPTION);
    }
}
