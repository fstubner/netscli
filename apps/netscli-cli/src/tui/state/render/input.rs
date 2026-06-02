use super::super::super::palette::palette;
use super::super::super::widgets::{
    build_suggestion_line, cursor_blink_on, draw_gradient_rounded_border, input_container_height,
    label_style, line_with_drawn_cursor, next_scroll_top, pad_line_to_width, placeholder_style,
    scrollbar_thumb, slice_chars, suggestion_window_start, value_style,
};
use super::super::{TuiApp, INPUT_PLACEHOLDER};
use crate::tui_settings::StatsUnit;
use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Padding, Paragraph, Wrap},
    Frame,
};

impl<'a> TuiApp<'a> {
    pub(super) fn render_input(&mut self, f: &mut Frame<'_>, area: Rect) {
        if area.width == 0 || area.height == 0 {
            return;
        }

        // If the terminal is too short for the full input layout, fall back to a compact
        // single-line input + optional stats row (avoids a "collapsed" box).
        if area.height < input_container_height(0) {
            let block = Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(label_style())
                .padding(Padding::horizontal(1));
            let inner = block.inner(area);
            f.render_widget(block, area);

            if inner.width == 0 || inner.height == 0 {
                return;
            }

            if inner.height == 1 {
                self.render_text_box(f, inner);
                return;
            }

            let input_row = Rect {
                x: inner.x,
                y: inner.y,
                width: inner.width,
                height: 1,
            };
            let stats_row = Rect {
                x: inner.x,
                y: inner.y.saturating_add(inner.height.saturating_sub(1)),
                width: inner.width,
                height: 1,
            };
            self.render_text_box(f, input_row);

            let (_left, right) = self.render_stats_lines();
            f.render_widget(Paragraph::new(right).alignment(Alignment::Right), stats_row);
            return;
        }

        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(label_style())
            .padding(Padding::horizontal(1));
        let inner = block.inner(area);
        f.render_widget(block, area);

        let text_box_h = 3u16;
        let stats_h = 1u16;

        // When the terminal is "medium short" (e.g. enough for the input container but not enough
        // for a full 6-item autocomplete list), shrink the suggestions list instead of letting
        // ratatui squeeze the textbox into a broken-looking single row.
        let min_inner_h = text_box_h.saturating_add(stats_h);
        let mut max_sugg_items_h = 0u16;
        if !self.suggestions.is_empty() && inner.height > min_inner_h {
            let remaining = inner.height.saturating_sub(min_inner_h);
            // Suggestions box needs its own borders (2) plus at least 1 item row (1) => 3.
            if remaining >= 3 {
                max_sugg_items_h = remaining.saturating_sub(2);
            }
        }

        let sugg_items_h = (self.suggestions.len().min(6) as u16).min(max_sugg_items_h);
        let sugg_box_h = if sugg_items_h > 0 {
            sugg_items_h + 2
        } else {
            0
        };

        let mut constraints = vec![Constraint::Length(text_box_h)];
        if sugg_box_h > 0 {
            constraints.push(Constraint::Length(sugg_box_h));
        }
        constraints.push(Constraint::Length(stats_h));

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(inner);

        self.render_text_box(f, chunks[0]);

        let mut idx = 1;
        if sugg_box_h > 0 {
            let sugg_area = chunks[idx];
            let sugg_block = Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(label_style())
                .padding(Padding::horizontal(1));
            let sugg_inner = sugg_block.inner(sugg_area);
            f.render_widget(sugg_block, sugg_area);

            let max_visible = sugg_items_h.max(1) as usize;
            let total = self.suggestions.len();
            let visible_len = total.min(max_visible);
            let start = suggestion_window_start(total, max_visible, self.suggestion_index);

            let show_scrollbar = total > max_visible && sugg_inner.width > 1;
            let bar_width = if show_scrollbar { 1 } else { 0 };
            let text_width = sugg_inner.width.saturating_sub(bar_width).max(1) as usize;

            let mut sugg_lines: Vec<Line<'static>> = Vec::new();
            let (thumb_top, thumb_height) =
                scrollbar_thumb(start as u16, total as u16, visible_len as u16);
            for i in 0..visible_len {
                let idx_abs = start + i;
                let s = self.suggestions[idx_abs];
                let selected = idx_abs == self.suggestion_index;
                let prefix = if selected { "> " } else { "  " };
                let mut line = build_suggestion_line(prefix, s, selected, text_width);
                line = pad_line_to_width(line, text_width, label_style());
                if show_scrollbar {
                    let row = i as u16;
                    let bar = if row >= thumb_top && row < thumb_top + thumb_height {
                        Span::styled("█", value_style())
                    } else {
                        Span::styled("│", label_style())
                    };
                    line.spans.push(bar);
                }
                sugg_lines.push(line);
            }
            f.render_widget(
                Paragraph::new(sugg_lines).wrap(Wrap { trim: false }),
                sugg_inner,
            );
            idx += 1;
        }

        let (left, right) = self.render_stats_lines();
        let parts = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[idx]);
        f.render_widget(Paragraph::new(left).alignment(Alignment::Left), parts[0]);
        f.render_widget(Paragraph::new(right).alignment(Alignment::Right), parts[1]);
    }

    fn render_text_box(&mut self, f: &mut Frame<'_>, area: Rect) {
        let w = area.width as usize;
        let blink_on = cursor_blink_on();
        if area.height < 3 || w < 8 {
            let (row, col) = self.input.cursor();
            let cursor_col = if row == 0 { col } else { 0 };
            let raw = self.input.lines().first().cloned().unwrap_or_default();
            let empty = raw.trim().is_empty();
            let display = if empty {
                INPUT_PLACEHOLDER.to_string()
            } else {
                raw.clone()
            };
            let width = area.width.max(1) as usize;
            let style = if empty {
                placeholder_style()
            } else {
                Style::default().fg(palette().text)
            };

            let prompt = "> ";
            let avail = width.saturating_sub(prompt.chars().count()).max(1);
            self.input_scroll_x = next_scroll_top(self.input_scroll_x, cursor_col, avail);
            if empty {
                self.input_scroll_x = 0;
            }
            let visible = slice_chars(&display, self.input_scroll_x, avail);
            let cursor_x = cursor_col
                .saturating_sub(self.input_scroll_x)
                .min(avail.saturating_sub(1));

            let mut spans = vec![Span::styled(prompt, placeholder_style())];
            spans.extend(line_with_drawn_cursor(&visible, style, cursor_x, avail, blink_on).spans);
            f.render_widget(
                Paragraph::new(Line::from(spans)).wrap(Wrap { trim: false }),
                area,
            );
            return;
        }

        let (row, col) = self.input.cursor();
        let cursor_col = if row == 0 { col } else { 0 };

        let raw = self.input.lines().first().cloned().unwrap_or_default();
        let empty = raw.trim().is_empty();
        let display = if empty {
            INPUT_PLACEHOLDER.to_string()
        } else {
            raw.clone()
        };

        draw_gradient_rounded_border(f, area);
        let inner = Rect {
            x: area.x.saturating_add(2),
            y: area.y.saturating_add(1),
            width: area.width.saturating_sub(4),
            height: area.height.saturating_sub(2),
        };

        let width = inner.width.max(1) as usize;
        let prompt = "> ";
        let avail = width.saturating_sub(prompt.chars().count()).max(1);
        self.input_scroll_x = next_scroll_top(self.input_scroll_x, cursor_col, avail);
        if empty {
            self.input_scroll_x = 0;
        }

        let visible = slice_chars(&display, self.input_scroll_x, avail);
        let style = if empty {
            placeholder_style()
        } else {
            Style::default().fg(palette().text)
        };
        let cursor_x = cursor_col
            .saturating_sub(self.input_scroll_x)
            .min(avail.saturating_sub(1));

        let mut spans = vec![Span::styled(prompt, placeholder_style())];
        spans.extend(line_with_drawn_cursor(&visible, style, cursor_x, avail, blink_on).spans);
        f.render_widget(
            Paragraph::new(Line::from(spans)).wrap(Wrap { trim: false }),
            inner,
        );
    }

    fn render_stats_lines(&mut self) -> (Line<'static>, Line<'static>) {
        let stats = self.monitor.get_stats();
        if stats.available {
            self.stats_upload_mbps = stats.upload_mbps;
            self.stats_download_mbps = stats.download_mbps;
            self.stats_upload_active = stats.upload_active;
            self.stats_download_active = stats.download_active;
        } else {
            self.stats_upload_mbps = 0.0;
            self.stats_download_mbps = 0.0;
            self.stats_upload_active = false;
            self.stats_download_active = false;
        }

        let dot = " · ";
        let unit: StatsUnit = self.settings.stats_unit;
        let up = format!(
            "{:.2}",
            unit.scale_from_mbps(self.stats_upload_mbps).min(999.99)
        );
        let down = format!(
            "{:.2}",
            unit.scale_from_mbps(self.stats_download_mbps).min(999.99)
        );
        let unit_suffix = format!(" {}", unit.suffix());

        let left = Line::from(vec![
            Span::styled("host ", label_style()),
            Span::styled(self.hostname.clone(), value_style()),
            Span::styled(dot, label_style()),
            Span::styled("ip ", label_style()),
            Span::styled(
                self.context_address
                    .clone()
                    .unwrap_or_else(|| "n/a".to_string()),
                value_style(),
            ),
        ]);

        let up_arrow_style = if self.stats_upload_active {
            Style::default().fg(Color::Cyan)
        } else {
            label_style()
        };
        let down_arrow_style = if self.stats_download_active {
            Style::default().fg(Color::Cyan)
        } else {
            label_style()
        };
        let number_style = value_style();

        let right_spans = vec![
            Span::styled("↑ ", up_arrow_style),
            Span::styled(up, number_style),
            Span::styled(unit_suffix.clone(), label_style()),
            Span::styled(dot, label_style()),
            Span::styled("↓ ", down_arrow_style),
            Span::styled(down, number_style),
            Span::styled(unit_suffix, label_style()),
        ];

        (left, Line::from(right_spans))
    }

    pub(super) fn spinner_frame(&mut self) -> &'static str {
        if !self.running {
            return " ";
        }
        let frames = ["-", "\\", "|", "/"];
        let ch = frames[self.spinner_idx % frames.len()];
        self.spinner_idx = (self.spinner_idx + 1) % frames.len();
        ch
    }
}
