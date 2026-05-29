#[cfg(feature = "pcap")]
use pcap::{Capture, Device};
use serde::Serialize;
use std::path::PathBuf;

use crate::error::{Error, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

pub const DEFAULT_PCAP_CAPTURE_SECONDS: u64 = 10;
pub const MAX_PCAP_CAPTURE_SECONDS: u64 = 60 * 60;
pub const MAX_PCAP_CAPTURE_PACKETS: usize = 1_000_000;

#[cfg(feature = "pcap")]
use crate::NetworkManager;
#[cfg(feature = "pcap")]
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
#[cfg(feature = "pcap")]
use std::{collections::HashSet, net::IpAddr, time::Instant};

#[cfg(feature = "pcap")]
const PCAP_LINKTYPE_ETHERNET: i32 = 1;
#[cfg(feature = "pcap")]
const PCAP_LINKTYPE_RAW: i32 = 101;
#[cfg(feature = "pcap")]
const DEFAULT_CAPTURE_PARSE_LIMIT: usize = 2_000;

#[derive(Debug, Serialize)]
pub struct PcapConfig {
    pub interface: String,
    pub filter: Option<String>,
    pub output_file: PathBuf,
    pub duration: Option<Duration>,
    pub max_packets: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct PcapResult {
    pub packets_captured: usize,
    pub duration: Duration,
    pub file_path: PathBuf,
    pub packets: Vec<PcapPacketSummary>,
    pub packets_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PcapPacketSummary {
    pub index: usize,
    pub timestamp: String,
    pub source: String,
    pub destination: String,
    pub protocol: String,
    pub length: u32,
    pub captured_length: u32,
    pub info: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PcapParseResult {
    pub file_path: PathBuf,
    pub link_type: i32,
    pub total_packets: usize,
    pub packets: Vec<PcapPacketSummary>,
    pub truncated: bool,
}

/// Cooperative cancellation token for long-running PCAP capture loops.
///
/// This is intentionally very small and dependency-free so it can be used across
/// CLI/TUI/MCP/Tauri surfaces without pulling in additional async utilities.
#[derive(Debug, Clone, Default)]
pub struct PcapCancelToken {
    cancelled: Arc<AtomicBool>,
}

impl PcapCancelToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

pub struct PcapEngine;

#[cfg(feature = "pcap")]
impl PcapEngine {
    /// Check whether libpcap/npf is available and list interfaces.
    pub fn check_support() -> Result<Vec<String>> {
        let devices = Device::list()?;
        if devices.is_empty() {
            return Err(Error::unsupported(
                "pcap available but no capture interfaces detected",
            ));
        }
        Ok(devices.into_iter().map(|d| d.name).collect())
    }

    pub fn capture(config: PcapConfig) -> Result<PcapResult> {
        Self::capture_with_cancel(config, None)
    }

    pub fn capture_with_cancel(
        config: PcapConfig,
        cancel: Option<PcapCancelToken>,
    ) -> Result<PcapResult> {
        let devices = Device::list()?;
        let device = resolve_capture_device(&devices, &config.interface)?;

        let mut cap = Capture::from_device(device)?
            .promisc(true)
            .snaplen(65535)
            // Keep the read timeout reasonably small so duration/cancellation checks
            // respond quickly even when there's no traffic.
            .timeout(250)
            .open()?;

        if let Some(filter) = &config.filter {
            cap.filter(filter, true)?;
        }

        let mut savefile = cap.savefile(&config.output_file)?;
        let start = Instant::now();
        let mut packets_captured = 0;

        loop {
            if cancel.as_ref().is_some_and(|c| c.is_cancelled()) {
                break;
            }

            // Check duration limit
            if let Some(duration) = config.duration {
                if start.elapsed() >= duration {
                    break;
                }
            }

            // Check packet count limit
            if let Some(max) = config.max_packets {
                if packets_captured >= max {
                    break;
                }
            }

            match cap.next_packet() {
                Ok(packet) => {
                    savefile.write(&packet);
                    packets_captured += 1;
                    // libpcap's dump writer doesn't surface write errors per-packet; flush
                    // periodically so we can detect IO errors (disk full, permission, etc.).
                    if packets_captured % 128 == 0 {
                        savefile
                            .flush()
                            .map_err(|e| Error::Other(format!("failed to flush savefile: {e}")))?;
                    }
                }
                Err(pcap::Error::TimeoutExpired) => continue,
                Err(e) => return Err(e.into()),
            }
        }

        savefile
            .flush()
            .map_err(|e| Error::Other(format!("failed to flush savefile: {e}")))?;
        drop(savefile);

        let parsed = Self::parse_file(
            config.output_file.clone(),
            Some(DEFAULT_CAPTURE_PARSE_LIMIT),
        )?;

        Ok(PcapResult {
            packets_captured,
            duration: start.elapsed(),
            file_path: config.output_file.clone(),
            packets: parsed.packets,
            packets_truncated: parsed.truncated,
        })
    }

    pub fn parse_file(path: PathBuf, max_packets: Option<usize>) -> Result<PcapParseResult> {
        let mut cap = Capture::from_file(&path)?;
        let link_type = cap.get_datalink().0;
        let mut packets = Vec::new();
        let mut total_packets = 0usize;

        loop {
            match cap.next_packet() {
                Ok(packet) => {
                    total_packets += 1;
                    if max_packets.is_none_or(|max| packets.len() < max) {
                        packets.push(summarize_packet(
                            total_packets,
                            link_type,
                            packet.header,
                            packet.data,
                        ));
                    }
                }
                Err(pcap::Error::NoMorePackets) => break,
                Err(e) => return Err(e.into()),
            }
        }

        let truncated = max_packets.is_some_and(|max| total_packets > max);
        Ok(PcapParseResult {
            file_path: path,
            link_type,
            total_packets,
            packets,
            truncated,
        })
    }
}

#[cfg(feature = "pcap")]
fn summarize_packet(
    index: usize,
    link_type: i32,
    header: &pcap::PacketHeader,
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
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

#[cfg(feature = "pcap")]
fn resolve_capture_device(devices: &[Device], requested: &str) -> Result<Device> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err(Error::invalid_input("capture interface is required"));
    }

    if let Some(device) = devices
        .iter()
        .find(|device| device_matches_label(device, requested))
    {
        return Ok(device.clone());
    }

    if let Some(device) = resolve_by_platform_adapter(devices, requested) {
        return Ok(device);
    }

    if let Some(device) = resolve_by_interface_addresses(devices, requested) {
        return Ok(device);
    }

    let available = devices
        .iter()
        .map(device_display_name)
        .collect::<Vec<_>>()
        .join(", ");
    Err(Error::invalid_input(format!(
        "Interface not found: {requested}. Available capture interfaces: {available}",
    )))
}

#[cfg(feature = "pcap")]
fn device_matches_label(device: &Device, requested: &str) -> bool {
    let requested = normalized_name(requested);
    if normalized_name(&device.name) == requested {
        return true;
    }

    device
        .desc
        .as_deref()
        .map(normalized_name)
        .is_some_and(|desc| desc == requested || desc.contains(&requested))
}

#[cfg(feature = "pcap")]
fn resolve_by_interface_addresses(devices: &[Device], requested: &str) -> Option<Device> {
    let requested = normalized_name(requested);
    let iface = NetworkManager::get_interfaces()
        .into_iter()
        .find(|iface| normalized_name(&iface.name) == requested)?;
    let ips = iface.ips.iter().map(|ip| ip.addr()).collect::<HashSet<_>>();

    device_by_addresses(devices, &ips)
}

#[cfg(feature = "pcap")]
fn device_by_addresses(devices: &[Device], ips: &HashSet<IpAddr>) -> Option<Device> {
    if ips.is_empty() {
        return None;
    }

    devices
        .iter()
        .find(|device| {
            device
                .addresses
                .iter()
                .any(|address| ips.contains(&address.addr))
        })
        .cloned()
}

#[cfg(all(feature = "pcap", target_os = "windows"))]
fn resolve_by_platform_adapter(devices: &[Device], requested: &str) -> Option<Device> {
    let requested = normalized_name(requested);
    let adapters = ipconfig::get_adapters().ok()?;

    for adapter in adapters {
        let friendly_name = adapter.friendly_name();
        let adapter_name = adapter.adapter_name();
        let requested_matches_adapter = normalized_name(friendly_name) == requested
            || normalized_name(adapter_name) == requested;

        if !requested_matches_adapter {
            continue;
        }

        let adapter_token = adapter_name.trim_matches(|c| c == '{' || c == '}');
        if let Some(device) = devices.iter().find(|device| {
            device.name.contains(adapter_name)
                || device.name.contains(adapter_token)
                || device_matches_label(device, friendly_name)
        }) {
            return Some(device.clone());
        }

        let ips = adapter
            .ip_addresses()
            .iter()
            .copied()
            .collect::<HashSet<IpAddr>>();
        if let Some(device) = device_by_addresses(devices, &ips) {
            return Some(device);
        }
    }

    None
}

#[cfg(all(feature = "pcap", not(target_os = "windows")))]
fn resolve_by_platform_adapter(_devices: &[Device], _requested: &str) -> Option<Device> {
    None
}

#[cfg(feature = "pcap")]
fn normalized_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

#[cfg(feature = "pcap")]
fn device_display_name(device: &Device) -> String {
    match device
        .desc
        .as_deref()
        .filter(|desc| !desc.trim().is_empty())
    {
        Some(desc) => format!("{desc} ({})", device.name),
        None => device.name.clone(),
    }
}

#[cfg(all(test, feature = "pcap"))]
mod tests {
    use super::*;

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

        let parsed =
            PcapEngine::parse_file(file.path().to_path_buf(), Some(1)).expect("parse pcap");

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
            0x45, 0x00, 0x00, 0x28, 0x00, 0x00, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 0xc0, 0xa8,
            0x01, 0x0a, 0x01, 0x01, 0x01, 0x01, // TCP
            0xd3, 0xd7, 0x01, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x02,
            0x72, 0x10, 0x00, 0x00, 0x00, 0x00,
        ]
    }
}

#[cfg(not(feature = "pcap"))]
impl PcapEngine {
    /// Check whether libpcap/npf is available and list interfaces.
    pub fn check_support() -> Result<Vec<String>> {
        Err(Error::unsupported(
            "pcap support disabled at compile time (built without feature 'pcap')",
        ))
    }

    pub fn capture(_config: PcapConfig) -> Result<PcapResult> {
        Err(Error::unsupported(
            "pcap support disabled at compile time (built without feature 'pcap')",
        ))
    }

    pub fn capture_with_cancel(
        _config: PcapConfig,
        _cancel: Option<PcapCancelToken>,
    ) -> Result<PcapResult> {
        Err(Error::unsupported(
            "pcap support disabled at compile time (built without feature 'pcap')",
        ))
    }

    pub fn parse_file(_path: PathBuf, _max_packets: Option<usize>) -> Result<PcapParseResult> {
        Err(Error::unsupported(
            "pcap support disabled at compile time (built without feature 'pcap')",
        ))
    }
}
