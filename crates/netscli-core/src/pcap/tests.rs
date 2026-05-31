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

fn sample_pcap_bytes(packet_count: usize) -> Vec<u8> {
    let frame = sample_tcp_frame();
    let mut bytes = Vec::new();
    bytes.extend(0xa1b2c3d4u32.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(4u16.to_le_bytes());
    bytes.extend(0i32.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(65_535u32.to_le_bytes());
    bytes.extend((PCAP_LINKTYPE_ETHERNET as u32).to_le_bytes());

    for i in 0..packet_count {
        bytes.extend((1_716_900_000u32 + i as u32).to_le_bytes());
        bytes.extend(1u32.to_le_bytes());
        bytes.extend((frame.len() as u32).to_le_bytes());
        bytes.extend((frame.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&frame);
    }

    bytes
}

fn sample_tcp_frame() -> [u8; 54] {
    [
        // Ethernet
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x08, 0x00,
        // IPv4
        0x45, 0x00, 0x00, 0x28, 0x00, 0x00, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 0xc0, 0xa8, 0x01,
        0x0a, 0x01, 0x01, 0x01, 0x01, // TCP
        0xd3, 0xd7, 0x01, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x02, 0x72,
        0x10, 0x00, 0x00, 0x00, 0x00,
    ]
}
