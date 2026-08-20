pub mod arp;
pub mod common;
#[cfg(feature = "db")]
pub mod db;
pub mod discover;
pub mod dns;
pub mod error;
pub mod inspect;
#[cfg(feature = "mdns")]
pub mod mdns;
pub mod ops;
pub mod oui;
pub mod pcap;
pub mod ping;
pub mod scan;
pub mod stats;
pub mod sweep;
pub mod trace;

pub use error::{Error, Result};

pub use arp::{ArpEntry, InterfaceInfo, NetworkManager};
pub use common::{
    default_ipv4_subnet_string, default_ports, detect_default_ipv4_addr,
    detect_default_ipv4_subnet, parse_ports, parse_ports_checked, sanitize_for_terminal,
    validate_ports, DEFAULT_CONCURRENCY, DEFAULT_DNS_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS,
    DEFAULT_PORTS, DEFAULT_SCAN_TIMEOUT_MS, DEFAULT_SUBNET, MAX_MDNS_TIMEOUT_MS, MAX_PING_COUNT,
    MAX_PORTS_PER_SCAN,
};
#[cfg(feature = "db")]
pub use db::{Database, HostRecord, ScanHistoryRecord};
pub use discover::{DiscoverEngine, DiscoverPhase, DiscoverProgress, Host};
pub use dns::{resolve_a, resolve_aaaa};
pub use inspect::{InspectEngine, InspectResult};
#[cfg(feature = "mdns")]
pub use mdns::{MdnsEngine, MdnsService, COMMON_SERVICE_TYPES};
pub use ops::{
    resolve_host_ip, resolve_host_ip_with_timeout, Ops, OpsConfig, PingSummary, MAX_CONCURRENCY,
};
pub use oui::lookup_vendor;
pub use pcap::{
    PcapCancelToken, PcapConfig, PcapEngine, PcapPacketSummary, PcapParseResult, PcapResult,
    DEFAULT_PCAP_CAPTURE_SECONDS, MAX_PCAP_CAPTURE_PACKETS, MAX_PCAP_CAPTURE_SECONDS,
};
pub use ping::{PingResult, PingScanner};
pub use scan::{
    HttpHeader, HttpProbe, PortResult, PortScanProgress, PortScanner, PortStatus, TlsProbe,
};
pub use stats::{NetworkMonitor, NetworkStats};
pub use sweep::{SweepEngine, SweepEntry, SweepPhase, SweepProgress};
pub use trace::{trace_route, TraceResult};
