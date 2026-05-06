//! Generic TUI rendering helpers used across the TuiApp render paths.
//!
//! Includes input-textarea wiring, palette-bound style accessors,
//! cursor blink helpers, line/span manipulation (truncate, pad,
//! gradient), scrollbar math, suggestion-row rendering for the input
//! prompt, and config-screen value cyclers.
//!
//! Functions are `pub(super)` so the rest of the `tui/` module can call
//! them but they don't leak outside (none are part of the TUI's
//! external API). Originally inline in `tui.rs`; extracted as part of
//! the state.rs decomposition so the TuiApp file holds only its
//! struct + impl, not the 600 lines of helpers underneath.
use super::command_catalog::CommandDef;
use super::palette::palette;
use crate::tui_settings::StatsUnit;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders},
    Frame,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tui_textarea::TextArea;

pub(super) const INPUT_PLACEHOLDER: &str = "Type /help for commands";

pub(super) fn configure_input(input: &mut TextArea<'_>) {
    input.set_cursor_line_style(Style::default());
    input.set_cursor_style(Style::default());
    input.set_style(Style::default().fg(palette().text));
    input.set_placeholder_text(INPUT_PLACEHOLDER);
    input.set_placeholder_style(label_style());
    input.set_block(Block::default().borders(Borders::NONE));
}

pub(super) fn label_style() -> Style {
    Style::default().fg(palette().label)
}

pub(super) fn value_style() -> Style {
    Style::default().fg(palette().value)
}

pub(super) fn placeholder_style() -> Style {
    // Use a mid-gray so the placeholder stays readable without overpowering the UI.
    Style::default().fg(palette().args)
}

pub(super) fn cursor_blink_on() -> bool {
    const BLINK_MS: u128 = 520;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    (ms / BLINK_MS).is_multiple_of(2)
}

pub(super) fn line_with_drawn_cursor(
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

pub(super) fn running_message(command: &str) -> String {
    let mut parts = command.split_whitespace();
    let cmd = parts.next().unwrap_or("").to_lowercase();
    match cmd.as_str() {
        "/discover" => match parts.next() {
            Some(subnet) => format!("Discovering {subnet}..."),
            None => "Discovering hosts...".to_string(),
        },
        "/scan" => match parts.next() {
            Some(host) => format!("Scanning {host}..."),
            None => "Scanning...".to_string(),
        },
        "/inspect" => match parts.next() {
            Some(host) => format!("Inspecting {host}..."),
            None => "Inspecting...".to_string(),
        },
        "/sweep" => match parts.next() {
            Some(subnet) => format!("Sweeping {subnet}..."),
            None => "Sweeping network...".to_string(),
        },
        "/dns" => match parts.next() {
            Some(host) => format!("Resolving {host}..."),
            None => "Resolving...".to_string(),
        },
        "/ping" => match parts.next() {
            Some(host) => format!("Pinging {host}..."),
            None => "Pinging...".to_string(),
        },
        "/trace" => match parts.next() {
            Some(host) => format!("Tracing {host}..."),
            None => "Tracing route...".to_string(),
        },
        "/arp" => "Reading ARP table...".to_string(),
        "/interfaces" => "Reading interfaces...".to_string(),
        "/mdns" => "Browsing mDNS...".to_string(),
        "/pcap" => "Capturing packets...".to_string(),
        _ => "Working...".to_string(),
    }
}

pub(super) fn build_suggestion_line(
    prefix: &str,
    def: CommandDef,
    selected: bool,
    max_width: usize,
) -> Line<'static> {
    let mut spans: Vec<(String, Style)> = Vec::new();
    spans.push((prefix.to_string(), label_style()));

    let cmd_style = if selected {
        Style::default()
            .fg(palette().text)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(palette().text)
    };
    spans.push((def.cmd.to_string(), cmd_style));
    spans.push((" ".to_string(), Style::default()));

    if !def.args.is_empty() {
        for (i, tok) in def.args.split_whitespace().enumerate() {
            if i > 0 {
                spans.push((" ".to_string(), Style::default()));
            }
            let style = if tok.starts_with("--") {
                Style::default().fg(palette().args_flag)
            } else if tok.starts_with('[') && tok.ends_with(']') {
                Style::default().fg(palette().args_optional)
            } else if tok.starts_with('<') && tok.ends_with('>') {
                Style::default().fg(palette().args_required)
            } else {
                Style::default().fg(palette().args)
            };
            spans.push((tok.to_string(), style));
        }
        spans.push((" ".to_string(), Style::default()));
    }

    spans.push(("- ".to_string(), label_style()));
    spans.push((def.desc.to_string(), Style::default().fg(palette().desc)));

    let spans = truncate_styled_spans(spans, max_width);
    Line::from(
        spans
            .into_iter()
            .map(|(s, st)| Span::styled(s, st))
            .collect::<Vec<_>>(),
    )
}

pub(super) fn truncate_styled_spans(
    mut spans: Vec<(String, Style)>,
    max_width: usize,
) -> Vec<(String, Style)> {
    if max_width == 0 {
        return Vec::new();
    }
    let current: usize = spans.iter().map(|(s, _)| s.chars().count()).sum();
    if current <= max_width {
        return spans;
    }
    if max_width <= 1 {
        return vec![("…".to_string(), label_style())];
    }

    let target = max_width - 1;
    let mut out: Vec<(String, Style)> = Vec::new();
    let mut used = 0usize;

    for (s, st) in spans.drain(..) {
        if used >= target {
            break;
        }
        let remaining = target - used;
        let take = s.chars().take(remaining).collect::<String>();
        let take_len = take.chars().count();
        if take_len > 0 {
            out.push((take, st));
            used += take_len;
        }
    }

    out.push(("…".to_string(), label_style()));
    out
}

pub(super) fn boxed_lines(
    inner: Vec<Line<'static>>,
    width: u16,
    border_style: Style,
) -> Vec<Line<'static>> {
    let w = width as usize;
    if w < 4 {
        return inner;
    }
    let pad = 1usize;
    let inner_w = w.saturating_sub(2 + pad * 2);

    let mut out: Vec<Line<'static>> = Vec::new();
    out.push(solid_border_line(
        '╭',
        '─',
        '╮',
        w.saturating_sub(2),
        border_style,
    ));

    let content_lines = if inner.is_empty() {
        vec![Line::default()]
    } else {
        inner
    };
    for line in content_lines {
        let clipped = truncate_line_to_width(line, inner_w, border_style);
        let current_w = line_width(&clipped);
        let pad_right = inner_w.saturating_sub(current_w);
        let mut spans: Vec<Span<'static>> = Vec::new();
        spans.push(Span::styled("│", border_style));
        spans.push(Span::raw(" ".repeat(pad)));
        spans.extend(clipped.spans);
        spans.push(Span::raw(" ".repeat(pad_right + pad)));
        spans.push(Span::styled("│", border_style));
        out.push(Line::from(spans));
    }

    out.push(solid_border_line(
        '╰',
        '─',
        '╯',
        w.saturating_sub(2),
        border_style,
    ));
    out
}

/// Terminal display width of a ratatui `Line`.
///
/// Uses `unicode-width` so East Asian wide chars (CJK) and emoji take 2
/// cells instead of being miscounted as 1. Previously this used
/// `chars().count()` which over-counted narrow multi-byte sequences and
/// under-counted wide glyphs, causing column-aligned tables to drift.
pub(super) fn line_width(line: &Line<'static>) -> usize {
    use unicode_width::UnicodeWidthStr;
    line.to_string().width()
}

pub(super) fn truncate_line_to_width(
    mut line: Line<'static>,
    max_width: usize,
    style: Style,
) -> Line<'static> {
    let width = line_width(&line);
    if width <= max_width {
        return line;
    }
    if max_width == 0 {
        return Line::default();
    }

    let target = max_width.saturating_sub(1);
    let mut out: Vec<Span<'static>> = Vec::new();
    let mut used = 0usize;

    for span in line.spans.drain(..) {
        if used >= target {
            break;
        }
        let s = span.content.to_string();
        let remaining = target - used;
        let take = s.chars().take(remaining).collect::<String>();
        used += take.chars().count();
        if !take.is_empty() {
            out.push(Span::styled(take, span.style));
        }
    }

    out.push(Span::styled("…", style));
    Line::from(out)
}

pub(super) fn solid_border_line(
    left: char,
    horiz: char,
    right: char,
    inner: usize,
    style: Style,
) -> Line<'static> {
    Line::from(vec![
        Span::styled(left.to_string(), style),
        Span::styled(horiz.to_string().repeat(inner), style),
        Span::styled(right.to_string(), style),
    ])
}

pub(super) fn gradient_text_line_with_left_pad(
    text: &str,
    width: usize,
    left_pad: usize,
) -> Line<'static> {
    let chars: Vec<char> = text.chars().collect();
    let max = width.max(1);
    let mut spans: Vec<Span<'static>> = Vec::with_capacity(chars.len() + 1);
    if left_pad > 0 {
        spans.push(Span::raw(" ".repeat(left_pad)));
    }
    for (i, ch) in chars.into_iter().take(width).enumerate() {
        let t = if max <= 1 {
            0.0
        } else {
            (i as f32) / ((max - 1) as f32)
        };
        spans.push(Span::styled(
            ch.to_string(),
            Style::default().fg(gradient_color(t)),
        ));
    }
    Line::from(spans)
}

pub(super) fn gradient_color(t: f32) -> Color {
    // Matches GUI gradient stops: #005A1E -> #0AAE7A -> #1EDCFF
    let t = t.clamp(0.0, 1.0);
    let (a, b, local) = if t <= 0.45 {
        ((0, 0x5a, 0x1e), (0x0a, 0xae, 0x7a), t / 0.45)
    } else {
        ((0x0a, 0xae, 0x7a), (0x1e, 0xdc, 0xff), (t - 0.45) / 0.55)
    };
    let lerp = |x: u8, y: u8| -> u8 {
        let xf = x as f32;
        let yf = y as f32;
        (xf + (yf - xf) * local).round().clamp(0.0, 255.0) as u8
    };
    Color::Rgb(lerp(a.0, b.0), lerp(a.1, b.1), lerp(a.2, b.2))
}

pub(super) fn input_container_height(suggestions_len: usize) -> u16 {
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

pub(super) fn suggestion_window_start(total: usize, window: usize, selected: usize) -> usize {
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

pub(super) fn pad_line_to_width(
    mut line: Line<'static>,
    width: usize,
    style: Style,
) -> Line<'static> {
    let current = line_width(&line);
    if current >= width {
        return line;
    }
    let pad = " ".repeat(width - current);
    line.spans.push(Span::styled(pad, style));
    line
}

pub(super) fn scrollbar_thumb(top: u16, total: u16, viewport: u16) -> (u16, u16) {
    if viewport == 0 || total <= viewport {
        return (0, viewport);
    }

    let viewport_u32 = viewport as u32;
    let total_u32 = total as u32;
    let thumb = ((viewport_u32 * viewport_u32) / total_u32).max(1) as u16;
    let thumb = thumb.min(viewport);

    let max_scroll = total.saturating_sub(viewport);
    let max_thumb_top = viewport.saturating_sub(thumb);
    let thumb_top = if max_scroll == 0 || max_thumb_top == 0 {
        0
    } else {
        ((top as u32 * max_thumb_top as u32) / max_scroll as u32) as u16
    };

    (thumb_top, thumb)
}

pub(super) fn next_scroll_top(prev_top: usize, cursor: usize, length: usize) -> usize {
    if length == 0 {
        return 0;
    }
    if cursor < prev_top {
        cursor
    } else if prev_top + length <= cursor {
        cursor + 1 - length
    } else {
        prev_top
    }
}

pub(super) fn slice_chars(text: &str, start: usize, len: usize) -> String {
    if len == 0 {
        return String::new();
    }
    text.chars().skip(start).take(len).collect()
}

pub(super) fn cycle_option(current: Option<&str>, options: &[String], dir: i32) -> Option<String> {
    let mut all = Vec::with_capacity(options.len() + 1);
    all.push("auto".to_string());
    all.extend(options.iter().cloned());

    if all.is_empty() {
        return None;
    }

    let current = current.unwrap_or("auto");
    let idx = all
        .iter()
        .position(|v| v.eq_ignore_ascii_case(current))
        .unwrap_or(0);
    let next = if dir < 0 {
        if idx == 0 {
            all.len() - 1
        } else {
            idx - 1
        }
    } else {
        (idx + 1) % all.len()
    };

    let value = &all[next];
    if value.eq_ignore_ascii_case("auto") {
        None
    } else {
        Some(value.clone())
    }
}

pub(super) fn cycle_unit(current: StatsUnit, dir: i32) -> StatsUnit {
    let units = [StatsUnit::Kbps, StatsUnit::Mbps, StatsUnit::Gbps];
    let idx = units.iter().position(|u| *u == current).unwrap_or(0);
    let next = if dir < 0 {
        if idx == 0 {
            units.len() - 1
        } else {
            idx - 1
        }
    } else {
        (idx + 1) % units.len()
    };
    units[next]
}

pub(super) fn config_line(label: &str, value: &str, selected: bool) -> Line<'static> {
    let bg = if selected {
        Some(Color::Rgb(52, 56, 64))
    } else {
        None
    };
    let mut label_style = Style::default().fg(Color::DarkGray);
    let mut value_style = Style::default().fg(Color::Gray);
    let mut prefix_style = Style::default().fg(Color::DarkGray);
    let mut action_style = Style::default().fg(Color::White);

    if let Some(bg) = bg {
        label_style = label_style.bg(bg);
        value_style = value_style.bg(bg);
        prefix_style = prefix_style.bg(bg);
        action_style = action_style.bg(bg);
    }

    if value.is_empty() {
        return Line::from(vec![
            Span::styled("  ", prefix_style),
            Span::styled(label.to_string(), action_style),
        ]);
    }

    Line::from(vec![
        Span::styled("  ", prefix_style),
        Span::styled(format!("{label}: "), label_style),
        Span::styled(value.to_string(), value_style),
    ])
}

pub(super) fn draw_gradient_rounded_border(f: &mut Frame<'_>, area: Rect) {
    if area.width < 2 || area.height < 2 {
        return;
    }

    let max_x = area.width.saturating_sub(1);
    let max_y = area.height.saturating_sub(1);
    let buf = f.buffer_mut();

    for dx in 0..area.width {
        let t = if max_x == 0 {
            0.0
        } else {
            dx as f32 / max_x as f32
        };
        let style = Style::default().fg(gradient_color(t));
        let x = area.x.saturating_add(dx);
        let top_y = area.y;
        let bottom_y = area.y.saturating_add(max_y);

        let top_ch = if dx == 0 {
            "╭"
        } else if dx == max_x {
            "╮"
        } else {
            "─"
        };
        let bottom_ch = if dx == 0 {
            "╰"
        } else if dx == max_x {
            "╯"
        } else {
            "─"
        };

        buf[(x, top_y)].set_symbol(top_ch).set_style(style);
        buf[(x, bottom_y)].set_symbol(bottom_ch).set_style(style);
    }

    for dy in 1..max_y {
        let y = area.y.saturating_add(dy);
        let left_style = Style::default().fg(gradient_color(0.0));
        let right_style = Style::default().fg(gradient_color(1.0));
        let left_x = area.x;
        let right_x = area.x.saturating_add(max_x);

        buf[(left_x, y)].set_symbol("│").set_style(left_style);
        buf[(right_x, y)].set_symbol("│").set_style(right_style);
    }
}
