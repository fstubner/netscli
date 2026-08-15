use pcap::Capture;
use std::path::PathBuf;

use crate::error::Result;

use super::protocols::summarize_packet;
use super::types::PcapParseResult;

/// Upper bound on packets counted while parsing a capture file.
///
/// Ten million is far beyond any capture this tool produces itself (the
/// bounded defaults in `ops/pcap.rs` are orders of magnitude smaller), so in
/// practice the count is exact; it exists only so a hostile or accidental
/// multi-GB file cannot make `parse_file` run unboundedly.
const MAX_SCAN_PACKETS: usize = 10_000_000;

pub(super) fn parse_file(path: PathBuf, max_packets: Option<usize>) -> Result<PcapParseResult> {
    let mut cap = Capture::from_file(&path)?;
    let link_type = cap.get_datalink().0;
    let mut packets = Vec::new();
    let mut total_packets = 0usize;

    let mut hit_scan_ceiling = false;

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

                // Bound the worst case (C-06).
                //
                // Once `max_packets` is reached this stops summarising, but it
                // kept walking the rest of the file purely to finish the count
                // — on a multi-GB capture that is a long wait for a number.
                //
                // Stopping early outright was the wrong fix: `total_packets` is
                // shown to the user as "N packets", so a short count would
                // quietly under-report. Instead the *count* runs to completion
                // for any realistic capture and only gives up past this
                // ceiling, where `truncated` already tells the caller the
                // figure is a floor.
                if total_packets >= MAX_SCAN_PACKETS {
                    hit_scan_ceiling = true;
                    break;
                }
            }
            Err(pcap::Error::NoMorePackets) => break,
            Err(e) => return Err(e.into()),
        }
    }

    // `hit_scan_ceiling` also means truncated: the file has more packets than
    // were counted, so `total_packets` is a floor rather than the true total.
    let truncated = hit_scan_ceiling || max_packets.is_some_and(|max| total_packets > max);
    Ok(PcapParseResult {
        file_path: path,
        link_type,
        total_packets,
        packets,
        truncated,
    })
}
