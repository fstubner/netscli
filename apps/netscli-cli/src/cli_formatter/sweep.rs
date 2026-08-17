use netscli_core::sanitize_for_terminal;
use netscli_core::sweep::SweepEntry;
use std::time::Instant;

use super::style::{cyan, dim, duration_tag, green, source_tag};
use super::CliFormatter;

impl CliFormatter {
    pub fn format_sweep_result(
        entries: &[SweepEntry],
        subnet: &str,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        let with_open: Vec<_> = entries
            .iter()
            .filter(|e| !e.open_ports.is_empty())
            .collect();

        let mut header_parts = vec![format!(
            "{} in subnet {} ({} hosts with open ports)",
            green(&format!("Swept {} hosts", entries.len())),
            cyan(subnet),
            with_open.len()
        )];
        if let Some(tag) = duration_tag(start_time) {
            header_parts.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            header_parts.push(src);
        }

        let mut out = header_parts.join(" ");
        if with_open.is_empty() {
            out.push_str("\n\n");
            out.push_str(&dim("No hosts with open ports."));
            return out;
        }

        out.push('\n');
        for entry in with_open {
            out.push('\n');
            out.push_str(&format!(
                "{} {}",
                dim("host"),
                cyan(&entry.host.ip.to_string()),
            ));
            if let Some(name) = &entry.host.hostname {
                // Remote-chosen; see the note in the discover formatter.
                let name = sanitize_for_terminal(name);
                out.push_str(&format!(" {}", dim(&format!("({name})"))));
            }
            out.push('\n');
            for port in &entry.open_ports {
                let service = port.service.as_deref().unwrap_or("unknown");
                out.push_str(&format!("  {:>5} {}\n", port.port, dim(service),));
            }
        }
        out
    }
}
