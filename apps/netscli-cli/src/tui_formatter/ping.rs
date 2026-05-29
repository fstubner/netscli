use super::Formatter;
use netscli_core::{PingResult, PingSummary};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
    pub fn format_ping_summary(summary: &PingSummary) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("PING ", Style::default().fg(Color::Cyan)),
            Span::styled(summary.host.clone(), Style::default().fg(Color::White)),
            Span::styled(" (", Style::default().fg(Color::DarkGray)),
            Span::styled(summary.ip.to_string(), Style::default().fg(Color::Green)),
            Span::styled(")", Style::default().fg(Color::DarkGray)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("sent=", Style::default().fg(Color::DarkGray)),
            Span::styled(summary.sent.to_string(), Style::default().fg(Color::White)),
            Span::raw(" "),
            Span::styled("received=", Style::default().fg(Color::DarkGray)),
            Span::styled(
                summary.received.to_string(),
                Style::default().fg(Color::White),
            ),
            Span::raw(" "),
            Span::styled("loss=", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{:.1}%", summary.loss_pct),
                Style::default().fg(if summary.loss_pct >= 100.0 {
                    Color::Red
                } else if summary.loss_pct > 0.0 {
                    Color::Yellow
                } else {
                    Color::Green
                }),
            ),
        ]));

        if let (Some(min), Some(max)) = (summary.rtt_ms_min, summary.rtt_ms_max) {
            if let Some(avg) = summary.rtt_ms_avg {
                lines.push(Line::from(vec![
                    Span::styled("rtt ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format!("min/avg/max = {min}/{avg:.1}/{max} ms"),
                        Style::default().fg(Color::Gray),
                    ),
                ]));
            }
        }

        lines
    }

    pub fn format_ping_attempt(seq: u32, total: u32, res: &PingResult) -> Line<'static> {
        let prefix = format!("{seq}/{total}");
        let status_style = Style::default().fg(if res.alive { Color::Green } else { Color::Red });

        let mut spans: Vec<Span<'static>> = vec![
            Span::styled("  seq ", Style::default().fg(Color::DarkGray)),
            Span::styled(prefix, Style::default().fg(Color::Gray)),
            Span::styled("  ", Style::default().fg(Color::DarkGray)),
        ];

        if res.alive {
            if let Some(rtt) = res.rtt_ms {
                spans.push(Span::styled(
                    format!("time={rtt} ms"),
                    Style::default().fg(Color::White),
                ));
            } else {
                spans.push(Span::styled("reply", Style::default().fg(Color::White)));
            }
        } else {
            spans.push(Span::styled("timeout", status_style));
            if let Some(err) = res.error.as_deref() {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(
                    err.to_string(),
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }

        if let Some(method) = res.method.as_deref() {
            spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
            spans.push(Span::styled(
                format!("({method})"),
                Style::default().fg(Color::DarkGray),
            ));
        }

        Line::from(spans)
    }
}
