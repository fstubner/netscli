use netscli_core::inspect::InspectResult;
use std::time::Instant;

use super::style::{cyan, dim, duration_tag, green, red, source_tag, white};
use super::CliFormatter;

impl CliFormatter {
    pub fn format_inspect_result(
        result: &InspectResult,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        let mut lines: Vec<String> = Vec::new();
        lines.push(cyan(&format!("Inspection Results for {}", result.host)));

        if let Some(ip) = result.ip {
            lines.push(format!("{} {}", dim("IP:"), white(&ip.to_string())));
        }
        if let Some(hostname) = &result.hostname {
            lines.push(format!("{} {}", dim("Hostname:"), white(hostname)));
        }
        if let Some(ping) = &result.ping {
            let status = if ping.alive {
                green("Alive")
            } else {
                red("Dead")
            };
            let mut ping_info = vec![status];
            if let Some(rtt) = ping.rtt_ms {
                ping_info.push(dim(&format!("{rtt}ms")));
            }
            lines.push(format!("{} {}", dim("Ping:"), ping_info.join(" ")));
        }

        if !result.open_ports.is_empty() {
            lines.push(String::new());
            lines.push(green("Open Ports:"));
            for port in &result.open_ports {
                let service = port.service.as_deref().unwrap_or("unknown");
                lines.push(format!(
                    "  {} ({})",
                    white(&port.port.to_string()),
                    dim(service)
                ));
            }
        }

        if let Some(tag) = duration_tag(start_time) {
            lines.push(String::new());
            lines.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            lines.push(src);
        }

        lines.join("\n")
    }
}
