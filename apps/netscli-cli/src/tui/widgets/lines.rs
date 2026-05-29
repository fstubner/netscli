use ratatui::{
    style::Style,
    text::{Line, Span},
};

pub(in crate::tui) fn boxed_lines(
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
fn line_width(line: &Line<'static>) -> usize {
    use unicode_width::UnicodeWidthStr;
    line.to_string().width()
}

fn truncate_line_to_width(
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

fn solid_border_line(
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

pub(in crate::tui) fn pad_line_to_width(
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
