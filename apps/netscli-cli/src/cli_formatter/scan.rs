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
            let state = match port.status {
                PortStatus::Open => green("OPEN"),
                PortStatus::Closed => red("CLOSED"),
                PortStatus::Filtered => yellow("FILTERED"),
                PortStatus::Error => red("ERROR"),
                PortStatus::OpenFiltered => yellow("OPEN|FILTERED"),
            };
            rows.push(format!(
                "{:<8} {:<14} {:<9} {:<14} {:<22} {}",
                port.port_label(),
                state,
                dim(&latency),
                dim(service),
                version.as_deref().unwrap_or("-"),
                dim(banner)
            ));
        }
        rows.join("\n")
    }
}
