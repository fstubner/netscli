use super::super::super::history::EntryState;
use super::super::super::palette::palette;
use super::super::super::widgets::{
    boxed_lines, gradient_text_line_with_left_pad, label_style, running_message, value_style,
};
use super::super::{TuiApp, ANSI_SHADOW_BANNER, TAGLINE, TIPS};
use crate::tui_formatter::Formatter;
use ratatui::{
    style::{Color, Style},
    text::{Line, Span},
};

impl<'a> TuiApp<'a> {
    pub(super) fn should_show_tip(&self) -> bool {
        self.history.is_empty() && !self.running && !self.tip_dismissed
    }

    pub(super) fn build_scroll_lines(&mut self, content_width: u16) -> Vec<Line<'static>> {
        let mut lines: Vec<Line<'static>> = Vec::new();
        lines.extend(self.header_lines(content_width as usize, u16::MAX));
        if self.should_show_tip() {
            let tip_text = TIPS.get(self.tip_index).copied().unwrap_or(TIPS[0]);
            let tip_line = Line::from(vec![
                Span::styled("Tip", Style::default().fg(palette().tip)),
                Span::styled(" · ", label_style()),
                Span::styled(tip_text.to_string(), value_style()),
            ]);
            lines.extend(boxed_lines(vec![tip_line], content_width, label_style()));
        }

        let spinner = self.spinner_frame();
        for (i, entry) in self.history.iter().enumerate() {
            let mut inner = Vec::new();
            inner.push(Formatter::format_command_prompt(&entry.command));
            if entry.state == EntryState::Running {
                let msg = running_message(&entry.command);
                inner.push(Line::from(vec![
                    Span::styled(spinner, Style::default().fg(Color::Cyan)),
                    Span::raw(" "),
                    Span::styled(msg, Style::default().fg(palette().text)),
                ]));
                if let Some(detail) = &self.running_detail {
                    inner.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(detail.to_string(), value_style()),
                    ]));
                }
            }
            if !entry.output.is_empty() {
                inner.push(Line::default());
                inner.extend(entry.output.clone());
            }

            lines.extend(boxed_lines(inner, content_width, label_style()));
            if i + 1 < self.history.len() {
                lines.push(Line::default());
            }
        }

        lines
    }

    pub(super) fn header_lines(&self, content_width: usize, max_height: u16) -> Vec<Line<'static>> {
        if max_height == 0 {
            return Vec::new();
        }

        let top_pad = if max_height < 18 { 2 } else { 3 };
        let mut lines: Vec<Line<'static>> = Vec::new();
        for _ in 0..top_pad {
            lines.push(Line::default());
        }

        let (banner, _rightmost) = self.banner_lines_centered(content_width);
        lines.extend(banner);

        let ver = format!("v{}", env!("CARGO_PKG_VERSION"));
        let sep = "  ·  ";
        let subtitle_plain = format!("{TAGLINE}{sep}{ver}");
        let subtitle_len = subtitle_plain.chars().count().min(content_width);
        let indent = content_width.saturating_sub(subtitle_len) / 2;
        lines.push(Line::from(vec![
            Span::raw(" ".repeat(indent)),
            Span::styled(TAGLINE, Style::default().fg(palette().text)),
            Span::styled(sep, label_style()),
            Span::styled(ver, label_style()),
        ]));

        lines.push(Line::default());

        while (lines.len() as u16) > max_height {
            lines.pop();
        }
        lines
    }

    fn banner_lines_centered(&self, width: usize) -> (Vec<Line<'static>>, usize) {
        let max_len = ANSI_SHADOW_BANNER
            .iter()
            .map(|l| l.chars().count())
            .max()
            .unwrap_or(1);
        let effective = max_len.max(1).min(width.max(1));

        let mut rightmost = 0usize;
        let lines: Vec<Line<'static>> = ANSI_SHADOW_BANNER
            .iter()
            .map(|line| {
                let len = line.chars().count().min(effective);
                let pad = width.saturating_sub(len) / 2;
                rightmost = rightmost.max(pad + len);
                gradient_text_line_with_left_pad(line, len.max(1), pad)
            })
            .collect();
        (lines, rightmost)
    }
}
