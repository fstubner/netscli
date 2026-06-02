mod cancel;
mod types;

pub use cancel::PcapCancelToken;
pub use types::{
    PcapConfig, PcapPacketSummary, PcapParseResult, PcapResult, DEFAULT_PCAP_CAPTURE_SECONDS,
    MAX_PCAP_CAPTURE_PACKETS, MAX_PCAP_CAPTURE_SECONDS,
};

use std::path::PathBuf;

#[cfg(not(feature = "pcap"))]
use crate::error::Error;
use crate::error::Result;

#[cfg(feature = "pcap")]
mod capture;
#[cfg(feature = "pcap")]
mod device;
#[cfg(feature = "pcap")]
mod parse;
#[cfg(feature = "pcap")]
mod protocols;
#[cfg(all(test, feature = "pcap"))]
mod tests;

pub struct PcapEngine;

#[cfg(feature = "pcap")]
impl PcapEngine {
    /// Check whether libpcap/npf is available and list interfaces.
    pub fn check_support() -> Result<Vec<String>> {
        capture::check_support()
    }

    pub fn capture(config: PcapConfig) -> Result<PcapResult> {
        capture::capture(config)
    }

    pub fn capture_with_cancel(
        config: PcapConfig,
        cancel: Option<PcapCancelToken>,
    ) -> Result<PcapResult> {
        capture::capture_with_cancel(config, cancel)
    }

    pub fn parse_file(path: PathBuf, max_packets: Option<usize>) -> Result<PcapParseResult> {
        parse::parse_file(path, max_packets)
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
