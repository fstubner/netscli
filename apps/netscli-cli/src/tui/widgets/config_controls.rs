use crate::tui_settings::StatsUnit;
use ratatui::{
    style::{Color, Style},
    text::{Line, Span},
};

pub(in crate::tui) fn cycle_option(
    current: Option<&str>,
    options: &[String],
    dir: i32,
) -> Option<String> {
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

pub(in crate::tui) fn cycle_unit(current: StatsUnit, dir: i32) -> StatsUnit {
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

pub(in crate::tui) fn config_line(label: &str, value: &str, selected: bool) -> Line<'static> {
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
