use netscli_core::PcapParseResult;

use super::style::{cyan, dim, green, yellow};
use super::table::column_width;
use super::CliFormatter;

impl CliFormatter {
    pub fn format_pcap_parse_result(result: &PcapParseResult) -> String {
        let shown = result.packets.len();
        let mut header = format!(
            "{} from {}",
            green(&format!(
                "Parsed {shown} packet{}",
                if shown == 1 { "" } else { "s" }
            )),
            cyan(&result.file_path.display().to_string())
        );
        if result.truncated {
            header.push_str(&format!(
                " {}",
                yellow(&format!("showing {shown} of {}", result.total_packets))
            ));
        }

        if result.packets.is_empty() {
            return format!("{header}\n\n{}", dim("No packets found."));
        }

        format!("{header}\n\n{}", Self::format_pcap_packet_table(result))
    }

    fn format_pcap_packet_table(result: &PcapParseResult) -> String {
        let time_width = column_width(
            result.packets.iter().map(|packet| packet.timestamp.len()),
            "Time".len(),
            18,
        );
        let source_width = column_width(
            result.packets.iter().map(|packet| packet.source.len()),
            "Source".len(),
            24,
        );
        let destination_width = column_width(
            result.packets.iter().map(|packet| packet.destination.len()),
            "Destination".len(),
            24,
        );

        let mut rows = vec![
            dim(&format!(
                "{:<6} {:<time_width$} {:<source_width$} {:<destination_width$} {:<8} {:<7} {}",
                "No.", "Time", "Source", "Destination", "Proto", "Length", "Info",
            )),
            dim(&"-".repeat(96)),
        ];

        for packet in &result.packets {
            rows.push(format!(
                "{:<6} {:<time_width$} {:<source_width$} {:<destination_width$} {:<8} {:<7} {}",
                packet.index,
                dim(&fit_cell(&packet.timestamp, time_width)),
                fit_cell(&packet.source, source_width),
                fit_cell(&packet.destination, destination_width),
                packet.protocol,
                packet.length,
                dim(&packet.info),
            ));
        }

        rows.join("\n")
    }
}

fn fit_cell(value: &str, width: usize) -> String {
    if value.chars().count() <= width {
        return value.to_string();
    }

    if width <= 3 {
        return ".".repeat(width);
    }

    let mut fitted = value.chars().take(width - 3).collect::<String>();
    fitted.push_str("...");
    fitted
}
