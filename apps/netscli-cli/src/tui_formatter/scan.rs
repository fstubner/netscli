use super::common::{fit_cell, tree_child_line, tree_prefix};
use super::Formatter;
use netscli_core::scan::{PortResult, PortStatus};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use std::net::IpAddr;

impl Formatter {
    pub fn format_scan_results(results: &[PortResult]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Ports", Style::default().fg(Color::Cyan)),
            Span::styled(" (scan results)", Style::default().fg(Color::DarkGray)),
        ]));

        if results.is_empty() {
            lines.push(Line::from(Span::styled(
                "No ports scanned.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for (idx, port) in results.iter().enumerate() {
            let (state_color, state) = match port.status {
                PortStatus::Open => (Color::Green, "open"),
                PortStatus::Closed => (Color::Red, "closed"),
                PortStatus::Filtered => (Color::Yellow, "filtered"),
                PortStatus::Error => (Color::Red, "error"),
            };
            let is_last = idx + 1 == results.len();
            let mut spans: Vec<Span<'static>> = vec![
                Span::styled(tree_prefix(is_last), Style::default().fg(Color::DarkGray)),
                Span::styled(port.port.to_string(), Style::default().fg(Color::White)),
                Span::styled(" ", Style::default().fg(Color::DarkGray)),
                Span::styled(state, Style::default().fg(state_color)),
            ];
            if let Some(latency_ms) = port.latency_ms {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(
                    format!("{latency_ms}ms"),
                    Style::default().fg(Color::Gray),
                ));
            } else if matches!(port.status, PortStatus::Filtered) {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled("timeout", Style::default().fg(Color::Yellow)));
            }
            if let Some(service) = &port.service {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(
                    service.to_string(),
                    Style::default().fg(Color::Gray),
                ));
            }
            if let Some(banner) = &port.banner {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(
                    fit_cell(banner, 42),
                    Style::default().fg(Color::DarkGray),
                ));
            }
            lines.push(Line::from(spans));
        }
        lines
    }

    pub fn format_scan_target_card(
        ip: IpAddr,
        hostname: Option<String>,
        mac: Option<String>,
        vendor: Option<String>,
        has_extra_child: bool,
    ) -> Vec<Line<'static>> {
        let hostname = hostname.unwrap_or_else(|| "-".to_string());
        let mac = mac.unwrap_or_else(|| "-".to_string());
        let vendor = vendor.unwrap_or_else(|| "-".to_string());

        let lines = vec![
            Line::from(vec![
                Span::styled("host ", Style::default().fg(Color::DarkGray)),
                Span::styled(ip.to_string(), Style::default().fg(Color::Green)),
            ]),
            tree_child_line("mac", &mac, false, Color::Yellow),
            tree_child_line("vendor", &vendor, false, Color::Blue),
            tree_child_line("name", &hostname, !has_extra_child, Color::Gray),
        ];
        lines
    }

    pub fn format_sweep_summary(
        subnet: &str,
        ports: &[u16],
        total_hosts: usize,
        hosts_with_open_ports: usize,
    ) -> Vec<Line<'static>> {
        let ports = ports
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(", ");

        vec![
            Line::from(vec![
                Span::styled("Swept subnet ", Style::default().fg(Color::Green)),
                Span::styled(subnet.to_string(), Style::default().fg(Color::Cyan)),
            ]),
            tree_child_line("ports", &ports, false, Color::Gray),
            tree_child_line(
                "hosts",
                &format!("{total_hosts} • open {hosts_with_open_ports}"),
                true,
                Color::Gray,
            ),
            Line::default(),
        ]
    }

    pub fn format_open_ports_inline(open_ports: &[PortResult]) -> Line<'static> {
        if open_ports.is_empty() {
            return tree_child_line("open ports", "none", true, Color::DarkGray);
        }

        let mut spans: Vec<Span<'static>> = vec![
            Span::styled(tree_prefix(true), Style::default().fg(Color::DarkGray)),
            Span::styled("open ports ", Style::default().fg(Color::DarkGray)),
        ];
        for (i, p) in open_ports.iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw(", "));
            }
            spans.push(Span::styled(
                p.port.to_string(),
                Style::default().fg(Color::White),
            ));
            if let Some(service) = &p.service {
                spans.push(Span::styled(
                    format!(" ({service})"),
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }
        Line::from(spans)
    }
}
