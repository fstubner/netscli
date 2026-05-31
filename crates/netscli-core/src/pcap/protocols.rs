use pcap::PacketHeader;
use pnet_packet::{
    arp::{ArpOperations, ArpPacket},
    ethernet::{EtherTypes, EthernetPacket},
    icmp::IcmpPacket,
    ip::IpNextHeaderProtocols,
    ipv4::Ipv4Packet,
    ipv6::Ipv6Packet,
    tcp::{TcpFlags, TcpPacket},
    udp::UdpPacket,
    Packet,
};

use super::types::PcapPacketSummary;

pub(super) const PCAP_LINKTYPE_ETHERNET: i32 = 1;
pub(super) const PCAP_LINKTYPE_RAW: i32 = 101;

pub(super) fn summarize_packet(
    index: usize,
    link_type: i32,
    header: &PacketHeader,
    data: &[u8],
) -> PcapPacketSummary {
    let mut summary = PcapPacketSummary {
        index,
        timestamp: format!("{}.{:06}", header.ts.tv_sec, header.ts.tv_usec),
        source: "-".to_string(),
        destination: "-".to_string(),
        protocol: format!("DLT {link_type}"),
        length: header.len,
        captured_length: header.caplen,
        info: "unsupported link type".to_string(),
    };

    match link_type {
        PCAP_LINKTYPE_ETHERNET => summarize_ethernet(data, &mut summary),
        PCAP_LINKTYPE_RAW => summarize_raw_ip(data, &mut summary),
        _ => {}
    }

    summary
}

fn summarize_ethernet(data: &[u8], summary: &mut PcapPacketSummary) {
    let Some(packet) = EthernetPacket::new(data) else {
        summary.info = "truncated Ethernet frame".to_string();
        return;
    };

    summary.source = packet.get_source().to_string();
    summary.destination = packet.get_destination().to_string();

    match packet.get_ethertype() {
        EtherTypes::Ipv4 => summarize_ipv4(packet.payload(), summary),
        EtherTypes::Ipv6 => summarize_ipv6(packet.payload(), summary),
        EtherTypes::Arp => summarize_arp(packet.payload(), summary),
        ether_type => {
            summary.protocol = format!("0x{:04x}", ether_type.0);
            summary.info = format!("EtherType 0x{:04x}", ether_type.0);
        }
    }
}

fn summarize_raw_ip(data: &[u8], summary: &mut PcapPacketSummary) {
    if data.is_empty() {
        summary.info = "empty raw IP packet".to_string();
        return;
    }

    match data[0] >> 4 {
        4 => summarize_ipv4(data, summary),
        6 => summarize_ipv6(data, summary),
        version => {
            summary.protocol = "IP".to_string();
            summary.info = format!("unsupported IP version {version}");
        }
    }
}

fn summarize_ipv4(data: &[u8], summary: &mut PcapPacketSummary) {
    let Some(packet) = Ipv4Packet::new(data) else {
        summary.protocol = "IPv4".to_string();
        summary.info = "truncated IPv4 packet".to_string();
        return;
    };

    summary.source = packet.get_source().to_string();
    summary.destination = packet.get_destination().to_string();
    match packet.get_next_level_protocol() {
        IpNextHeaderProtocols::Tcp => summarize_tcp(packet.payload(), summary),
        IpNextHeaderProtocols::Udp => summarize_udp(packet.payload(), summary),
        IpNextHeaderProtocols::Icmp => summarize_icmp(packet.payload(), "ICMP", summary),
        proto => {
            summary.protocol = format!("IPv4/{}", proto.0);
            summary.info = format!("IPv4 protocol {}", proto.0);
        }
    }
}

fn summarize_ipv6(data: &[u8], summary: &mut PcapPacketSummary) {
    let Some(packet) = Ipv6Packet::new(data) else {
        summary.protocol = "IPv6".to_string();
        summary.info = "truncated IPv6 packet".to_string();
        return;
    };

    summary.source = packet.get_source().to_string();
    summary.destination = packet.get_destination().to_string();
    match packet.get_next_header() {
        IpNextHeaderProtocols::Tcp => summarize_tcp(packet.payload(), summary),
        IpNextHeaderProtocols::Udp => summarize_udp(packet.payload(), summary),
        IpNextHeaderProtocols::Icmpv6 => summarize_icmp(packet.payload(), "ICMPv6", summary),
        proto => {
            summary.protocol = format!("IPv6/{}", proto.0);
            summary.info = format!("IPv6 next header {}", proto.0);
        }
    }
}

fn summarize_tcp(data: &[u8], summary: &mut PcapPacketSummary) {
    summary.protocol = "TCP".to_string();
    let Some(packet) = TcpPacket::new(data) else {
        summary.info = "truncated TCP segment".to_string();
        return;
    };

    let flags = tcp_flags(packet.get_flags());
    let payload_len = packet.payload().len();
    summary.info = format!(
        "{} -> {} [{}] Len={payload_len}",
        packet.get_source(),
        packet.get_destination(),
        flags
    );
}

fn summarize_udp(data: &[u8], summary: &mut PcapPacketSummary) {
    summary.protocol = "UDP".to_string();
    let Some(packet) = UdpPacket::new(data) else {
        summary.info = "truncated UDP datagram".to_string();
        return;
    };

    summary.info = format!(
        "{} -> {} Len={}",
        packet.get_source(),
        packet.get_destination(),
        packet.get_length()
    );
}

fn summarize_icmp(data: &[u8], protocol: &str, summary: &mut PcapPacketSummary) {
    summary.protocol = protocol.to_string();
    let Some(packet) = IcmpPacket::new(data) else {
        summary.info = format!("truncated {protocol} packet");
        return;
    };

    summary.info = format!(
        "type {} code {}",
        packet.get_icmp_type().0,
        packet.get_icmp_code().0
    );
}

fn summarize_arp(data: &[u8], summary: &mut PcapPacketSummary) {
    summary.protocol = "ARP".to_string();
    let Some(packet) = ArpPacket::new(data) else {
        summary.info = "truncated ARP packet".to_string();
        return;
    };

    summary.source = packet.get_sender_proto_addr().to_string();
    summary.destination = packet.get_target_proto_addr().to_string();
    summary.info = match packet.get_operation() {
        ArpOperations::Request => format!(
            "Who has {}? Tell {}",
            packet.get_target_proto_addr(),
            packet.get_sender_proto_addr()
        ),
        ArpOperations::Reply => format!(
            "{} is at {}",
            packet.get_sender_proto_addr(),
            packet.get_sender_hw_addr()
        ),
        operation => format!("ARP operation {}", operation.0),
    };
}

fn tcp_flags(flags: u8) -> String {
    let mut names = Vec::new();
    if flags & TcpFlags::FIN != 0 {
        names.push("FIN");
    }
    if flags & TcpFlags::SYN != 0 {
        names.push("SYN");
    }
    if flags & TcpFlags::RST != 0 {
        names.push("RST");
    }
    if flags & TcpFlags::PSH != 0 {
        names.push("PSH");
    }
    if flags & TcpFlags::ACK != 0 {
        names.push("ACK");
    }
    if flags & TcpFlags::URG != 0 {
        names.push("URG");
    }
    if names.is_empty() {
        "-".to_string()
    } else {
        names.join(",")
    }
}
