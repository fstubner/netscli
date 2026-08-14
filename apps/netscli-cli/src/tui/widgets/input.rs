use super::super::palette::palette;
use super::styles::{label_style, placeholder_style as palette_placeholder_style};
use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders},
};
use ratatui_textarea::TextArea;
use std::time::{SystemTime, UNIX_EPOCH};
use unicode_width::UnicodeWidthStr;

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

    // Pad to `width` *cells*, not chars, and split on cell boundaries. Padding
    // by `chars.len()` under-filled any line containing a wide character and
    // then sliced by char index, so the reversed cursor cell landed left of
    // where the caret actually was (B-08).
    let left = slice_cols(text, 0, cursor_x);
    let cursor_cell = slice_cols(text, cursor_x, 1);
    let cursor_cell = if cursor_cell.is_empty() {
        " ".to_string()
    } else {
        cursor_cell
    };
    let cursor_w = UnicodeWidthStr::width(cursor_cell.as_str()).max(1);
    let right_start = cursor_x.saturating_add(cursor_w);
    let mut right = slice_cols(text, right_start, width.saturating_sub(right_start));

    // Trailing padding so the styled run still covers the full box.
    let used =
        UnicodeWidthStr::width(left.as_str()) + cursor_w + UnicodeWidthStr::width(right.as_str());
    if used < width {
        right.push_str(&" ".repeat(width - used));
    }

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
    spans.push(Span::styled(cursor_cell, cursor_style));
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

/// Terminal columns occupied by the first `char_index` characters.
///
/// The textarea reports the cursor as a *character* index, but everything
/// downstream — scrolling, slicing, cursor placement — works in terminal
/// cells. Conflating the two put the cursor in the wrong place and let the
/// input overflow its box as soon as a wide character was typed (B-08).
pub(in crate::tui) fn display_col(text: &str, char_index: usize) -> usize {
    use unicode_width::UnicodeWidthChar;
    text.chars()
        .take(char_index)
        .map(|c| c.width().unwrap_or(0))
        .sum()
}

/// Slice `len` terminal columns starting at column `start`.
///
/// A wide character straddling either edge is dropped rather than split,
/// since half of one cannot be rendered.
pub(in crate::tui) fn slice_cols(text: &str, start: usize, len: usize) -> String {
    use unicode_width::UnicodeWidthChar;
    if len == 0 {
        return String::new();
    }
    let mut col = 0usize;
    let mut out = String::new();
    for ch in text.chars() {
        let w = ch.width().unwrap_or(0);
        if col >= start.saturating_add(len) {
            break;
        }
        if col >= start {
            if col + w > start + len {
                break;
            }
            out.push(ch);
        }
        col += w;
    }
    out
}
