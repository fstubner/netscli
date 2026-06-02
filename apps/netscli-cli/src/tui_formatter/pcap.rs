use super::Formatter;
use netscli_core::PcapResult;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
    pub fn format_pcap_interfaces(devs: &[String]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("PCAP ", Style::default().fg(Color::Cyan)),
            Span::styled("Interfaces", Style::default().fg(Color::White)),
        ]));

        if devs.is_empty() {
            lines.push(Line::from(Span::styled(
                "No capture interfaces detected.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for d in devs {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::DarkGray)),
                Span::styled(d.to_string(), Style::default().fg(Color::Gray)),
            ]));
        }
        lines
    }

    pub fn format_pcap_result(res: &PcapResult) -> Vec<Line<'static>> {
        vec![Line::from(vec![
            Span::styled("Captured ", Style::default().fg(Color::Green)),
            Span::styled(
                res.packets_captured.to_string(),
                Style::default().fg(Color::White),
            ),
            Span::styled(" packets to ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                res.file_path.display().to_string(),
                Style::default().fg(Color::Cyan),
            ),
        ])]
    }
}
