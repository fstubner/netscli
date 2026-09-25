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

        if let Some(vendor) = &res.vendor {
            lines.push(Line::from(vec![
                Span::styled("MAC:  ", Style::default().fg(Color::Cyan)),
                Span::raw(format!("{} ({vendor})", res.mac.as_deref().unwrap_or("-"))),
            ]));
        }
        if let Some(hint) = &res.os_hint {
            lines.push(Line::from(vec![
                Span::styled("OS:   ", Style::default().fg(Color::Cyan)),
                Span::raw(hint.summary()),
                Span::styled(" (hint)", Style::default().fg(Color::DarkGray)),
            ]));
            for clue in &hint.evidence {
                lines.push(Line::from(Span::styled(
                    format!("      {clue}"),
                    Style::default().fg(Color::DarkGray),
                )));
            }
        }

        if !res.open_ports.is_empty() {
            lines.push(Line::from(""));
            lines.push(Span::styled("Open Ports:", Style::default().fg(Color::Yellow)).into());
            lines.extend(Self::format_scan_results(&res.open_ports));
        }

        lines
    }
}
