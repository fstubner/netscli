#[cfg(feature = "pcap")]
use pcap::{Capture, Device};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

#[cfg(feature = "pcap")]
use std::time::Instant;

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
    pub fn check_support() -> anyhow::Result<Vec<String>> {
        let devices = Device::list().map_err(|e| anyhow::anyhow!("pcap unavailable: {e}"))?;
        if devices.is_empty() {
            anyhow::bail!("pcap available but no capture interfaces detected");
        }
        Ok(devices.into_iter().map(|d| d.name).collect())
    }

    pub fn capture(config: PcapConfig) -> anyhow::Result<PcapResult> {
        Self::capture_with_cancel(config, None)
    }

    pub fn capture_with_cancel(
        config: PcapConfig,
        cancel: Option<PcapCancelToken>,
    ) -> anyhow::Result<PcapResult> {
        let device = Device::list()?
            .into_iter()
            .find(|d| d.name == config.interface)
            .ok_or_else(|| anyhow::anyhow!("Interface not found"))?;

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
                            .map_err(|e| anyhow::anyhow!("failed to flush savefile: {e}"))?;
                    }
                }
                Err(pcap::Error::TimeoutExpired) => continue,
                Err(e) => return Err(e.into()),
            }
        }

        savefile
            .flush()
            .map_err(|e| anyhow::anyhow!("failed to flush savefile: {e}"))?;

        Ok(PcapResult {
            packets_captured,
            duration: start.elapsed(),
            file_path: config.output_file,
        })
    }
}

#[cfg(not(feature = "pcap"))]
impl PcapEngine {
    /// Check whether libpcap/npf is available and list interfaces.
    pub fn check_support() -> anyhow::Result<Vec<String>> {
        anyhow::bail!("pcap support disabled at compile time (built without feature 'pcap')")
    }

    pub fn capture(_config: PcapConfig) -> anyhow::Result<PcapResult> {
        anyhow::bail!("pcap support disabled at compile time (built without feature 'pcap')")
    }

    pub fn capture_with_cancel(
        _config: PcapConfig,
        _cancel: Option<PcapCancelToken>,
    ) -> anyhow::Result<PcapResult> {
        anyhow::bail!("pcap support disabled at compile time (built without feature 'pcap')")
    }
}
