use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

pub const DEFAULT_PCAP_CAPTURE_SECONDS: u64 = 10;
pub const MAX_PCAP_CAPTURE_SECONDS: u64 = 60 * 60;
pub const MAX_PCAP_CAPTURE_PACKETS: usize = 1_000_000;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tcp_flags: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icmp_type: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icmp_code: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arp_operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ethernet_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ethernet_destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hex_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PcapParseResult {
    pub file_path: PathBuf,
    pub link_type: i32,
    pub total_packets: usize,
    pub packets: Vec<PcapPacketSummary>,
    pub truncated: bool,
}
