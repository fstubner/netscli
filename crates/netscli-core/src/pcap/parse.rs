use pcap::Capture;
use std::path::PathBuf;

use crate::error::Result;

use super::protocols::summarize_packet;
use super::types::PcapParseResult;

pub(super) fn parse_file(path: PathBuf, max_packets: Option<usize>) -> Result<PcapParseResult> {
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
