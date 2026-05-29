use super::super::palette::palette;
use super::styles::{label_style, placeholder_style as palette_placeholder_style};
use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders},
};
use std::time::{SystemTime, UNIX_EPOCH};
use tui_textarea::TextArea;

pub(super) const INPUT_PLACEHOLDER: &str = "Type /help for commands";

pub(in crate::tui) fn configure_input(input: &mut TextArea<'_>) {
    input.set_cursor_line_style(Style::default());
    input.set_cursor_style(Style::default());
    input.set_style(Style::default().fg(palette().text));
    input.set_placeholder_text(INPUT_PLACEHOLDER);
    input.set_placeholder_style(label_style());
    input.set_block(Block::default().borders(Borders::NONE));
}

pub(in crate::tui) fn placeholder_style() -> Style {
    palette_placeholder_style()
}

pub(in crate::tui) fn cursor_blink_on() -> bool {
    const BLINK_MS: u128 = 520;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    (ms / BLINK_MS).is_multiple_of(2)
}

pub(in crate::tui) fn line_with_drawn_cursor(
    text: &str,
    style: Style,
    cursor_x: usize,
    width: usize,
    blink_on: bool,
) -> Line<'static> {
    let width = width.max(1);
    let cursor_x = cursor_x.min(width.saturating_sub(1));
    let mut chars: Vec<char> = text.chars().collect();
    while chars.len() < width {
        chars.push(' ');
    }
    let left: String = chars.iter().take(cursor_x).collect();
    let cursor_cell = chars.get(cursor_x).copied().unwrap_or(' ');
    let right: String = chars
        .iter()
        .skip(cursor_x.saturating_add(1))
        .take(width.saturating_sub(cursor_x.saturating_add(1)))
        .collect();

    let mut spans: Vec<Span<'static>> = Vec::new();
    if !left.is_empty() {
        spans.push(Span::styled(left, style));
    }
    let cursor_style = if blink_on {
        Style::default()
            .fg(palette().text)
            .add_modifier(Modifier::REVERSED)
    } else {
        style
    };
    spans.push(Span::styled(cursor_cell.to_string(), cursor_style));
    if !right.is_empty() {
        spans.push(Span::styled(right, style));
    }
    Line::from(spans)
}

pub(in crate::tui) fn input_container_height(suggestions_len: usize) -> u16 {
    let sugg_items = suggestions_len.min(6) as u16;
    if sugg_items == 0 {
        // inner: textbox (3) + stats (1) => 4; outer: +2 borders => 6
        6
    } else {
        // inner: textbox (3) + suggestions box (items + 2) + stats (1) => items + 6
        // outer: +2 borders => items + 8
        sugg_items + 8
    }
}

pub(in crate::tui) fn suggestion_window_start(
    total: usize,
    window: usize,
    selected: usize,
) -> usize {
    if total <= window {
        return 0;
    }

    let half = window / 2;
    let mut start = selected.saturating_sub(half);
    let max_start = total.saturating_sub(window);
    if start > max_start {
        start = max_start;
    }
    start
}

pub(in crate::tui) fn slice_chars(text: &str, start: usize, len: usize) -> String {
    if len == 0 {
        return String::new();
    }
    text.chars().skip(start).take(len).collect()
}
