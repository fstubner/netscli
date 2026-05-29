use super::Formatter;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

impl Formatter {
    pub fn format_command_prompt(command: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::DarkGray)),
            Span::styled(command.to_string(), Style::default().fg(Color::Cyan)),
        ])
    }

    pub fn format_error(message: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                "Error: ",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
            Span::raw(message.to_string()),
        ])
    }

    pub fn format_notice(message: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                "Note: ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(message.to_string()),
        ])
    }
}

pub(super) fn tree_prefix(is_last: bool) -> &'static str {
    if is_last {
        "  └─ "
    } else {
        "  ├─ "
    }
}

pub(super) fn tree_child_line(
    label: &str,
    value: &str,
    is_last: bool,
    value_color: Color,
) -> Line<'static> {
    Line::from(vec![
        Span::styled(tree_prefix(is_last), Style::default().fg(Color::DarkGray)),
        Span::styled(format!("{label} "), Style::default().fg(Color::DarkGray)),
        Span::styled(value.to_string(), Style::default().fg(value_color)),
    ])
}

pub(super) fn fit_cell(value: &str, width: usize) -> String {
    use unicode_width::UnicodeWidthChar;

    let value = value.trim();

    // Accumulate chars until adding one more would exceed `width` in terminal cells.
    let mut used = 0usize;
    let mut kept: Vec<char> = Vec::with_capacity(value.len());
    let mut truncated = false;
    for ch in value.chars() {
        let w = ch.width().unwrap_or(0);
        if used + w > width {
            truncated = true;
            break;
        }
        kept.push(ch);
        used += w;
    }

    if truncated && width > 1 {
        while used > width.saturating_sub(1) {
            if let Some(last) = kept.pop() {
                used -= last.width().unwrap_or(0);
            } else {
                break;
            }
        }
        kept.push('…');
        used += 1;
    }

    let mut out: String = kept.into_iter().collect();
    let len = used;
    if len < width {
        out.push_str(&" ".repeat(width - len));
    }
    out
}
