use crate::commands;
use crate::tui_formatter::Formatter;
use netscli_core::{Database, Ops};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

pub(super) async fn handle_lookup(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    // Walk arguments so `--record TYPE`, `--record=TYPE`, `-r TYPE`,
    // or a positional second token all work regardless of order.
    let mut host: Option<String> = None;
    let mut record: Option<String> = None;
    let mut i = 1;
    let mut parse_err: Option<String> = None;
    while i < parts.len() {
        let tok = parts[i];
        if let Some(val) = tok.strip_prefix("--record=") {
            record = Some(val.to_uppercase());
            i += 1;
        } else if tok == "--record" || tok == "-r" {
            match parts.get(i + 1) {
                Some(val) => {
                    record = Some(val.to_uppercase());
                    i += 2;
                }
                None => {
                    parse_err = Some("--record requires a value".to_string());
                    break;
                }
            }
        } else if tok.starts_with('-') {
            parse_err = Some(format!("unknown flag: {tok}"));
            break;
        } else if host.is_none() {
            host = Some(tok.to_string());
            i += 1;
        } else {
            // Accept a positional second arg as the record type for
            // forgiving usage (e.g. `/dns example.com MX`).
            if record.is_none() {
                record = Some(tok.to_uppercase());
            }
            i += 1;
        }
    }

    if let Some(err) = parse_err {
        out.push(Formatter::format_error(&format!(
            "{err}. Usage: /dns <host> [--record <type>|ALL]"
        )));
    } else if let Some(host) = host {
        match commands::run_dns(ops, db, &host, record.clone()).await {
            Ok(records) => {
                out.extend(Formatter::format_dns_results(
                    &host,
                    record.as_deref(),
                    &records,
                ));
            }
            Err(e) => out.push(Formatter::format_error(&format!("DNS error: {}", e))),
        }
    } else {
        out.push(Formatter::format_error(
            "Usage: /dns <host> [--record <type>|ALL]",
        ));
    }
    out
}

pub(super) async fn handle_reverse(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    if let Some(raw_ip) = parts.get(1) {
        match commands::run_reverse(ops, db, raw_ip).await {
            Ok(Some(name)) => {
                out.push(Line::from(vec![
                    Span::styled("PTR ", Style::default().fg(Color::Cyan)),
                    Span::styled(raw_ip.to_string(), Style::default().fg(Color::White)),
                    Span::styled(" ", Style::default().fg(Color::DarkGray)),
                    Span::styled(name, Style::default().fg(Color::Green)),
                ]));
            }
            Ok(None) => out.push(Line::from(Span::styled(
                "No PTR record found.",
                Style::default().fg(Color::DarkGray),
            ))),
            Err(e) => out.push(Formatter::format_error(&format!("DNS error: {}", e))),
        }
    } else {
        out.push(Formatter::format_error("Usage: /reverse <ip>"));
    }
    out
}
