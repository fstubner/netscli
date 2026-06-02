use super::super::command_catalog::CommandDef;
use super::super::palette::palette;
use super::styles::label_style;
use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};

pub(in crate::tui) fn running_message(command: &str) -> String {
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

pub(in crate::tui) fn build_suggestion_line(
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

fn truncate_styled_spans(
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
