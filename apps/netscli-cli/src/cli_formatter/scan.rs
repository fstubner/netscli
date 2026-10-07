use netscli_core::scan::{PortResult, PortStatus, Protocol};
use std::time::Instant;

use super::style::{cyan, dim, duration_tag, green, red, source_tag, yellow};
use super::CliFormatter;

impl CliFormatter {
    pub fn format_scan_result(
        results: &[PortResult],
        host: &str,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        if results.is_empty() {
            let mut parts = vec![format!("{} on {}", yellow("No ports scanned"), cyan(host))];
            if let Some(tag) = duration_tag(start_time) {
                parts.push(tag);
            }
            return parts.join(" ");
        }

        let open_count = results.iter().filter(|p| p.open).count();
        let udp = results.iter().any(|p| p.protocol == Protocol::Udp);
        let noun = match (udp, results.len() == 1) {
            (true, true) => "UDP port",
            (true, false) => "UDP ports",
            (false, true) => "port",
            (false, false) => "ports",
        };
        let mut header_parts = vec![format!(
            "{} on {}",
            green(&format!(
                "Scanned {} {noun} ({open_count} open)",
                results.len()
            )),
            cyan(host)
        )];
        if let Some(tag) = duration_tag(start_time) {
            header_parts.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            header_parts.push(src);
        }

        format!(
            "{}\n\n{}",
            header_parts.join(" "),
            Self::format_scan_table(results)
        )
    }

    fn format_scan_table(ports: &[PortResult]) -> String {
        let header = dim(&format!(
            "{:<8} {:<14} {:<9} {:<14} {:<22} {}",
            "Port", "State", "Latency", "Service", "Version", "Banner"
        ));
        let separator = dim(&"-".repeat(88));

        let mut rows = vec![header, separator];
        for port in ports {
            let service = port.service.as_deref().unwrap_or("unknown");
            let version = port.product_and_version();
            let latency = port
                .latency_ms
                .map(|ms| format!("{ms}ms"))
                .unwrap_or_else(|| match port.status {
                    PortStatus::Filtered => "timeout".to_string(),
                    _ => "-".to_string(),
                });
            let banner = port
                .banner
                .as_deref()
                .or_else(|| {
                    if port.status == PortStatus::Error {
                        port.error.as_deref()
                    } else {
                        None
                    }
                })
                .unwrap_or("-");
            // Pad first and colour second. The colour codes are characters
            // too, and `{:<14}` counts them, so padding a coloured cell left
            // it a few columns short and slid the rest of the row left.
            let state = match port.status {
                PortStatus::Open => green(&format!("{:<14}", "OPEN")),
                PortStatus::Closed => red(&format!("{:<14}", "CLOSED")),
                PortStatus::Filtered => yellow(&format!("{:<14}", "FILTERED")),
                PortStatus::Error => red(&format!("{:<14}", "ERROR")),
                PortStatus::OpenFiltered => yellow(&format!("{:<14}", "OPEN|FILTERED")),
            };
            rows.push(format!(
                "{:<8} {} {} {} {:<22} {}",
                port.port_label(),
                state,
                dim(&format!("{latency:<9}")),
                dim(&format!("{service:<14}")),
                version.as_deref().unwrap_or("-"),
                dim(banner)
            ));
        }
        rows.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::super::style::with_color;
    use super::*;

    fn port(port: u16, status: PortStatus, latency_ms: Option<u64>, service: &str) -> PortResult {
        PortResult {
            port,
            protocol: Protocol::Tcp,
            open: status == PortStatus::Open,
            status,
            service: Some(service.to_string()),
            product: None,
            version: None,
            latency_ms,
            banner: None,
            http: None,
            tls: None,
            raw: None,
            error: None,
        }
    }

    /// The text a terminal shows, which is the text without its colour codes.
    fn visible(text: &str) -> String {
        let mut out = String::new();
        let mut chars = text.chars();
        while let Some(c) = chars.next() {
            if c == '\u{1b}' {
                // ESC [ ... m
                for end in chars.by_ref() {
                    if end == 'm' {
                        break;
                    }
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    #[test]
    fn a_coloured_scan_table_lines_up_like_the_plain_one() {
        let ports = [
            port(22, PortStatus::Open, Some(1), "ssh"),
            port(80, PortStatus::Closed, Some(12), "http"),
            port(443, PortStatus::Filtered, None, "https"),
            port(5353, PortStatus::OpenFiltered, None, "mdns"),
        ];
        let plain = with_color(false, || CliFormatter::format_scan_table(&ports));
        let coloured = with_color(true, || CliFormatter::format_scan_table(&ports));

        assert!(coloured.contains('\u{1b}'), "colour was not applied");
        // Colour changes how the table looks, never where anything sits.
        assert_eq!(visible(&coloured), plain);
    }
}
