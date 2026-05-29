use super::common::tree_child_line;
use super::Formatter;
use netscli_core::discover::Host;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
    pub fn format_discovered_hosts(hosts: &[Host]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Discovered hosts ", Style::default().fg(Color::Green)),
            Span::styled(hosts.len().to_string(), Style::default().fg(Color::White)),
        ]));
        lines.push(Line::default());

        if hosts.is_empty() {
            lines.push(Line::from(Span::styled(
                "No hosts discovered.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for (idx, host) in hosts.iter().enumerate() {
            let vendor = host.vendor.clone().unwrap_or_else(|| "-".to_string());
            let hostname = host.hostname.clone().unwrap_or_else(|| "-".to_string());
            let mac = host.mac.clone().unwrap_or_else(|| "-".to_string());

            lines.push(Line::from(vec![
                Span::styled("host ", Style::default().fg(Color::DarkGray)),
                Span::styled(host.ip.to_string(), Style::default().fg(Color::Green)),
            ]));
            lines.push(tree_child_line("mac", &mac, false, Color::Yellow));
            lines.push(tree_child_line("vendor", &vendor, false, Color::Blue));
            lines.push(tree_child_line("name", &hostname, true, Color::Gray));

            if idx + 1 < hosts.len() {
                lines.push(Line::default());
            }
        }
        lines
    }
}
