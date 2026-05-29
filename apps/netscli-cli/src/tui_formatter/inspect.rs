use super::Formatter;
use netscli_core::inspect::InspectResult;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
    pub fn format_inspect_result(res: &InspectResult) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Host: ", Style::default().fg(Color::Cyan)),
            Span::raw(res.host.clone()),
        ]));
        if let Some(ip) = res.ip {
            lines.push(Line::from(vec![
                Span::styled("IP:   ", Style::default().fg(Color::Cyan)),
                Span::raw(ip.to_string()),
            ]));
        }

        if let Some(ping) = &res.ping {
            let status = if ping.alive { "UP" } else { "DOWN" };
            let color = if ping.alive { Color::Green } else { Color::Red };
            lines.push(Line::from(vec![
                Span::styled("Ping: ", Style::default().fg(Color::Cyan)),
                Span::styled(status, Style::default().fg(color)),
                Span::raw(format!(" (RTT: {:?})", ping.rtt_ms)),
            ]));
        }

        if !res.open_ports.is_empty() {
            lines.push(Line::from(""));
            lines.push(Span::styled("Open Ports:", Style::default().fg(Color::Yellow)).into());
            lines.extend(Self::format_scan_results(&res.open_ports));
        }

        lines
    }
}
