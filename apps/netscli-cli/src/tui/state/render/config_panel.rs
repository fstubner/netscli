use super::super::super::config::{ConfigItemKind, ConfigUiState};
use super::super::super::widgets::config_line;
use super::super::TuiApp;
use ratatui::{
    style::{Color, Style},
    text::{Line, Span},
};

impl<'a> TuiApp<'a> {
    pub(super) fn build_config_lines(
        &self,
        content_width: u16,
        state: &ConfigUiState,
    ) -> (Vec<Line<'static>>, Vec<usize>) {
        let mut lines: Vec<Line<'static>> = Vec::new();
        let mut item_lines: Vec<usize> = Vec::new();

        lines.extend(self.header_lines(content_width as usize, u16::MAX));
        lines.push(Line::default());
        lines.push(Line::from(vec![Span::styled(
            "Config",
            Style::default().fg(Color::Cyan),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Use \u{2191}/\u{2193} to move, \u{2190}/\u{2192} to change, Enter to apply, Esc to exit.",
            Style::default().fg(Color::DarkGray),
        )]));
        lines.push(Line::default());

        let resolved = self
            .context_address
            .clone()
            .unwrap_or_else(|| "n/a".to_string());

        for (idx, item) in state.items.iter().enumerate() {
            if *item == ConfigItemKind::Reset {
                lines.push(Line::default());
            }

            let selected = idx == state.selected;
            let (label, value) = match item {
                ConfigItemKind::MaxConcurrentProbes => (
                    "max concurrent probes",
                    self.effective_concurrent_probes().to_string(),
                ),
                ConfigItemKind::StatsInterface => (
                    "stats interface",
                    self.settings
                        .stats_interface
                        .clone()
                        .unwrap_or_else(|| "auto".to_string()),
                ),
                ConfigItemKind::StatsUnit => {
                    ("stats unit", self.settings.stats_unit.suffix().into())
                }
                ConfigItemKind::DisplayInterface => (
                    "display interface",
                    self.settings
                        .display_interface
                        .clone()
                        .unwrap_or_else(|| "auto".to_string()),
                ),
                ConfigItemKind::DisplayIp => (
                    "display ip",
                    if let Some(ip) = self.settings.display_ip.clone() {
                        ip
                    } else {
                        format!("auto (resolved: {resolved})")
                    },
                ),
                ConfigItemKind::Reset => ("Reset to defaults", String::new()),
                ConfigItemKind::Done => ("Done", String::new()),
            };

            item_lines.push(lines.len());
            lines.push(config_line(label, &value, selected));
        }

        if let Some(msg) = state.message.as_deref() {
            lines.push(Line::default());
            lines.push(Line::from(vec![
                Span::styled("Error: ", Style::default().fg(Color::Red)),
                Span::styled(msg.to_string(), Style::default().fg(Color::Gray)),
            ]));
        }

        (lines, item_lines)
    }
}
