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
        Self::capture_with_cancel(config, None)
    }

    /// Capture packets to `config.output_file`.
    ///
    /// Refuses a config with no stopping condition. Every field of
    /// `PcapConfig` is public, and the helper that guarantees at least one
    /// bound lives in the `ops` layer -- so a caller constructing the config
    /// directly with `duration: None, max_packets: None` got a loop that
    /// breaks only on cancel, and `capture` does not even accept a cancel
    /// token. It wrote packets until the filesystem filled.
    pub fn capture_with_cancel(
        config: PcapConfig,
        cancel: Option<PcapCancelToken>,
    ) -> Result<PcapResult> {
        if config.duration.is_none() && config.max_packets.is_none() && cancel.is_none() {
            return Err(crate::error::Error::invalid_input(
                "packet capture needs a duration, a max packet count, or a cancel token",
            ));
        }
        capture::capture_with_cancel(config, cancel)
    }

    /// Summarise packets from a capture file.
    ///
    /// `max_packets` is bounded here rather than trusted. `None` meant
    /// "retain every packet", and `Ops::parse_pcap_file` forwarded the
    /// caller's value untouched while the capture paths normalised theirs --
    /// so a ~500 MB file of 10M small frames built 10M summaries, about 5 GB,
    /// each carrying an unconditional 191-char hex preview.
    pub fn parse_file(path: PathBuf, max_packets: Option<usize>) -> Result<PcapParseResult> {
        let bounded = max_packets
            .unwrap_or(crate::MAX_PCAP_CAPTURE_PACKETS)
            .min(crate::MAX_PCAP_CAPTURE_PACKETS);
        parse::parse_file(path, Some(bounded))
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
