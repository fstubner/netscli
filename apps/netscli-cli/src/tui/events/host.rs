use crate::tui_formatter::Formatter;
use netscli_core::{Ops, PingScanner};
use ratatui::text::Line;
use tokio::sync::watch;

pub(super) async fn handle_ping(
    parts: &[&str],
    ops: &Ops,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    if let Some(host) = parts.get(1) {
        let count: u32 = parts
            .get(2)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(4)
            .max(1);

        let ip = match ops.resolve_host_ip(host).await {
            Ok(ip) => ip,
            Err(e) => {
                out.push(Formatter::format_error(&format!("{e}")));
                return out;
            }
        };

        let scanner = PingScanner::new(1);
        let mut rtts: Vec<u64> = Vec::new();
        let mut received: u32 = 0;
        let mut attempts: Vec<Line<'static>> = Vec::new();

        for seq in 1..=count {
            let res = scanner.ping(ip, ops.config().ping_timeout_ms).await;
            if res.alive {
                received += 1;
                if let Some(rtt) = res.rtt_ms {
                    rtts.push(rtt);
                }
            }

            if let Some(tx) = &progress {
                let status = if res.alive {
                    res.rtt_ms
                        .map(|r| format!("{r} ms"))
                        .unwrap_or_else(|| "reply".to_string())
                } else {
                    "timeout".to_string()
                };
                let _ = tx.send(format!(
                    "ping {seq}/{count} \u{2022} {status} \u{2022} received {received}"
                ));
            }

            attempts.push(Formatter::format_ping_attempt(seq, count, &res));
        }
        attempts.push(Line::default());

        let sent = count;
        let loss_pct = if sent == 0 {
            0.0
        } else {
            100.0 * (sent - received) as f64 / sent as f64
        };
        let rtt_ms_min = rtts.iter().min().copied();
        let rtt_ms_max = rtts.iter().max().copied();
        let rtt_ms_avg = if rtts.is_empty() {
            None
        } else {
            Some((rtts.iter().sum::<u64>() as f64) / (rtts.len() as f64))
        };

        let summary = netscli_core::PingSummary {
            host: host.to_string(),
            ip,
            sent,
            received,
            loss_pct,
            rtt_ms_min,
            rtt_ms_max,
            rtt_ms_avg,
        };

        let mut lines = Formatter::format_ping_summary(&summary);
        lines.splice(1..1, attempts);
        out.extend(lines);
    } else {
        out.push(Formatter::format_error("Usage: /ping <host> [count]"));
    }
    out
}

pub(super) async fn handle_trace(
    parts: &[&str],
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let mut host: Option<String> = None;
    let mut resolve = false;
    let mut max_hops: u32 = 30;

    let mut i = 1usize;
    while i < parts.len() {
        match parts[i] {
            "--resolve" => {
                resolve = true;
                i += 1;
            }
            "--max-hops" => {
                let Some(value) = parts.get(i + 1) else {
                    out.push(Formatter::format_error("Missing value for --max-hops"));
                    return out;
                };
                max_hops = match value.parse::<u32>() {
                    Ok(v) => v,
                    Err(_) => {
                        out.push(Formatter::format_error(
                            "Invalid --max-hops (expected integer)",
                        ));
                        return out;
                    }
                };
                i += 2;
            }
            tok if tok.starts_with('-') => {
                out.push(Formatter::format_error(&format!("Unknown flag: {tok}")));
                return out;
            }
            tok => {
                if host.is_none() {
                    host = Some(tok.to_string());
                }
                i += 1;
            }
        }
    }

    let Some(host) = host else {
        out.push(Formatter::format_error(
            "Usage: /trace <host> [--resolve] [--max-hops <n>]",
        ));
        return out;
    };

    match crate::trace::trace_route(&host, max_hops, resolve, progress).await {
        Ok(res) => {
            out.push(Line::from(format!("Trace ({})", res.tool)));
            out.push(Line::default());
            for l in res.lines {
                out.push(Line::from(l));
            }
        }
        Err(e) => out.push(Formatter::format_error(&format!("{e}"))),
    }
    out
}
