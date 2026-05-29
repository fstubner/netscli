use super::Formatter;
use netscli_core::dns::DnsRecord;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
    pub fn format_dns_results(
        host: &str,
        record: Option<&str>,
        records: &[DnsRecord],
    ) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        let record_label = record.unwrap_or("ALL").to_string();
        lines.push(Line::from(vec![
            Span::styled("DNS ", Style::default().fg(Color::Cyan)),
            Span::styled(record_label.clone(), Style::default().fg(Color::Cyan)),
            Span::styled(" for ", Style::default().fg(Color::DarkGray)),
            Span::styled(host.to_string(), Style::default().fg(Color::White)),
        ]));

        if records.is_empty() {
            lines.push(Line::from(Span::styled(
                "No records found.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        if matches!(record, Some("ALL") | Some("ANY") | None) {
            let mut order: Vec<String> = Vec::new();
            let mut grouped: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for rec in records {
                if !grouped.contains_key(&rec.record_type) {
                    order.push(rec.record_type.clone());
                }
                grouped
                    .entry(rec.record_type.clone())
                    .or_default()
                    .push(rec.value.clone());
            }

            for (idx, rec_type) in order.iter().enumerate() {
                if idx > 0 {
                    lines.push(Line::default());
                }
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default().fg(Color::DarkGray)),
                    Span::styled(rec_type.to_string(), Style::default().fg(Color::Cyan)),
                ]));
                if let Some(values) = grouped.get(rec_type) {
                    for value in values {
                        lines.push(Line::from(vec![
                            Span::styled("    ", Style::default().fg(Color::DarkGray)),
                            Span::styled(value.to_string(), Style::default().fg(Color::Green)),
                        ]));
                    }
                }
            }
        } else {
            for rec in records {
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default().fg(Color::DarkGray)),
                    Span::styled(rec.value.to_string(), Style::default().fg(Color::Green)),
                ]));
            }
        }
        lines
    }
}
