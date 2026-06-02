use super::protocols::PCAP_LINKTYPE_ETHERNET;
use super::PcapEngine;

#[test]
fn parses_ethernet_ipv4_tcp_packet() {
    let file = tempfile::NamedTempFile::new().expect("temp pcap");
    std::fs::write(file.path(), sample_pcap_bytes(1)).expect("write pcap");

    let parsed = PcapEngine::parse_file(file.path().to_path_buf(), None).expect("parse pcap");

    assert_eq!(parsed.link_type, PCAP_LINKTYPE_ETHERNET);
    assert_eq!(parsed.total_packets, 1);
    assert!(!parsed.truncated);
    let packet = parsed.packets.first().expect("packet");
    assert_eq!(packet.index, 1);
    assert_eq!(packet.source, "192.168.1.10");
    assert_eq!(packet.destination, "1.1.1.1");
    assert_eq!(packet.protocol, "TCP");
    assert_eq!(packet.length, 54);
    assert_eq!(packet.info, "54231 -> 443 [SYN] Len=0");
    assert_eq!(packet.source_port, Some(54231));
    assert_eq!(packet.destination_port, Some(443));
    assert_eq!(packet.tcp_flags.as_deref(), Some("SYN"));
    assert_eq!(packet.ethernet_source.as_deref(), Some("66:77:88:99:aa:bb"));
    assert_eq!(
        packet
            .hex_preview
            .as_deref()
            .map(|hex| hex.starts_with("00 11")),
        Some(true)
    );
}

#[test]
fn parse_limit_truncates_rows_but_counts_packets() {
    let file = tempfile::NamedTempFile::new().expect("temp pcap");
    std::fs::write(file.path(), sample_pcap_bytes(2)).expect("write pcap");

    let parsed = PcapEngine::parse_file(file.path().to_path_buf(), Some(1)).expect("parse pcap");

    assert_eq!(parsed.total_packets, 2);
    assert!(parsed.truncated);
    assert_eq!(parsed.packets.len(), 1);
}

#[test]
fn parses_udp_icmp_and_arp_fields() {
    let file = tempfile::NamedTempFile::new().expect("temp pcap");
    std::fs::write(
        file.path(),
        sample_pcap_frames(&[sample_udp_frame(), sample_icmp_frame(), sample_arp_frame()]),
    )
    .expect("write pcap");

    let parsed = PcapEngine::parse_file(file.path().to_path_buf(), None).expect("parse pcap");

    let udp = &parsed.packets[0];
    assert_eq!(udp.protocol, "UDP");
    assert_eq!(udp.source_port, Some(5353));
    assert_eq!(udp.destination_port, Some(5353));

    let icmp = &parsed.packets[1];
    assert_eq!(icmp.protocol, "ICMP");
    assert_eq!(icmp.icmp_type, Some(8));
    assert_eq!(icmp.icmp_code, Some(0));

    let arp = &parsed.packets[2];
    assert_eq!(arp.protocol, "ARP");
    assert_eq!(arp.arp_operation.as_deref(), Some("request"));
    assert_eq!(arp.source, "192.168.1.10");
    assert_eq!(arp.destination, "192.168.1.1");
}

fn sample_pcap_bytes(packet_count: usize) -> Vec<u8> {
    let frame = sample_tcp_frame();
    sample_pcap_frames(&vec![frame; packet_count])
}

fn sample_pcap_frames(frames: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend(0xa1b2c3d4u32.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(4u16.to_le_bytes());
    bytes.extend(0i32.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(65_535u32.to_le_bytes());
    bytes.extend((PCAP_LINKTYPE_ETHERNET as u32).to_le_bytes());

    for (i, frame) in frames.iter().enumerate() {
        bytes.extend((1_716_900_000u32 + i as u32).to_le_bytes());
        bytes.extend(1u32.to_le_bytes());
        bytes.extend((frame.len() as u32).to_le_bytes());
        bytes.extend((frame.len() as u32).to_le_bytes());
        bytes.extend_from_slice(frame);
    }

    bytes
}

fn ethernet_header(ether_type: [u8; 2]) -> Vec<u8> {
    let mut bytes = vec![
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
    ];
    bytes.extend(ether_type);
    bytes
}

fn ipv4_header(total_len: u16, protocol: u8) -> Vec<u8> {
    let mut bytes = vec![0x45, 0x00];
    bytes.extend(total_len.to_be_bytes());
    bytes.extend([0x00, 0x00, 0x40, 0x00, 0x40, protocol, 0x00, 0x00]);
    bytes.extend([0xc0, 0xa8, 0x01, 0x0a, 0x01, 0x01, 0x01, 0x01]);
    bytes
}

fn sample_tcp_frame() -> Vec<u8> {
    let mut bytes = ethernet_header([0x08, 0x00]);
    bytes.extend(ipv4_header(40, 6));
    bytes.extend([
        0xd3, 0xd7, 0x01, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x02, 0x72,
        0x10, 0x00, 0x00, 0x00, 0x00,
    ]);
    bytes
}

fn sample_udp_frame() -> Vec<u8> {
    let mut bytes = ethernet_header([0x08, 0x00]);
    bytes.extend(ipv4_header(28, 17));
    bytes.extend([0x14, 0xe9, 0x14, 0xe9, 0x00, 0x08, 0x00, 0x00]);
    bytes
}

fn sample_icmp_frame() -> Vec<u8> {
    let mut bytes = ethernet_header([0x08, 0x00]);
    bytes.extend(ipv4_header(28, 1));
    bytes.extend([0x08, 0x00, 0x00, 0x00, 0x12, 0x34, 0x00, 0x01]);
    bytes
}

fn sample_arp_frame() -> Vec<u8> {
    let mut bytes = ethernet_header([0x08, 0x06]);
    bytes.extend([
        0x00, 0x01, 0x08, 0x00, 0x06, 0x04, 0x00, 0x01, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xc0,
        0xa8, 0x01, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0xa8, 0x01, 0x01,
    ]);
    bytes
}
