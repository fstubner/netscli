use pcap::{Capture, Device};
use std::time::Instant;

use crate::error::{Error, Result};

use super::cancel::PcapCancelToken;
use super::device::resolve_capture_device;
use super::parse::parse_file;
use super::types::{PcapConfig, PcapResult};

const DEFAULT_CAPTURE_PARSE_LIMIT: usize = 2_000;

pub(super) fn check_support() -> Result<Vec<String>> {
    let devices = Device::list()?;
    if devices.is_empty() {
        return Err(Error::unsupported(
            "pcap available but no capture interfaces detected",
        ));
    }
    Ok(devices.into_iter().map(|d| d.name).collect())
}

pub(super) fn capture_with_cancel(
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

        if let Some(duration) = config.duration {
            if start.elapsed() >= duration {
                break;
            }
        }

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

    let parsed = parse_file(
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
