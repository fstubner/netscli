#[cfg(feature = "pcap")]
use crate::commands;
use crate::tui_formatter::Formatter;
use netscli_core::{Database, Ops, PcapCancelToken};
use ratatui::text::Line;
use tokio::sync::watch;

#[cfg(not(feature = "pcap"))]
pub(super) async fn handle(
    _parts: &[&str],
    _ops: &Ops,
    _db: Option<&Database>,
    _pcap_cancel: Option<PcapCancelToken>,
    _progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    vec![
        Formatter::format_notice("PCAP capture isn't available in this build."),
        Line::default(),
        Line::from(
            "Install a pcap-enabled build (NETSCLI_PCAP=1) or build from source with --features pcap.",
        ),
        Line::from("Then run: /pcap --check"),
        Line::from("See README.md -> PCAP Support (Optional)."),
    ]
}

#[cfg(feature = "pcap")]
pub(super) async fn handle(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
    pcap_cancel: Option<PcapCancelToken>,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();

    if let Some(tx) = &progress {
        let _ = tx.send("Press Esc or Ctrl+C to stop capture.".to_string());
    }

    let mut check = false;
    let mut interface: Option<String> = None;
    let mut filter: Option<String> = None;
    let mut duration: Option<u64> = None;
    let mut output: Option<String> = None;
    let mut max_packets: Option<usize> = None;

    let mut i = 1usize;
    while i < parts.len() {
        match parts[i] {
            "--check" => {
                check = true;
                i += 1;
            }
            "-i" | "--interface" => {
                let Some(value) = parts.get(i + 1) else {
                    out.push(Formatter::format_error("Missing value for --interface"));
                    return out;
                };
                interface = Some((*value).to_string());
                i += 2;
            }
            "--filter" => {
                let Some(value) = parts.get(i + 1) else {
                    out.push(Formatter::format_error("Missing value for --filter"));
                    return out;
                };
                filter = Some((*value).to_string());
                i += 2;
            }
            "--duration" => {
                let Some(value) = parts.get(i + 1) else {
                    out.push(Formatter::format_error("Missing value for --duration"));
                    return out;
                };
                duration = match value.parse::<u64>() {
                    Ok(v) => Some(v),
                    Err(_) => {
                        out.push(Formatter::format_error(
                            "Invalid --duration (expected seconds)",
                        ));
                        return out;
                    }
                };
                i += 2;
            }
            "--output" => {
                let Some(value) = parts.get(i + 1) else {
                    out.push(Formatter::format_error("Missing value for --output"));
                    return out;
                };
                output = Some((*value).to_string());
                i += 2;
            }
            "--max-packets" => {
                let Some(value) = parts.get(i + 1) else {
                    out.push(Formatter::format_error("Missing value for --max-packets"));
                    return out;
                };
                max_packets = match value.parse::<usize>() {
                    Ok(v) => Some(v),
                    Err(_) => {
                        out.push(Formatter::format_error(
                            "Invalid --max-packets (expected integer)",
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
                if interface.is_none() {
                    interface = Some(tok.to_string());
                }
                i += 1;
            }
        }
    }

    if check || interface.is_none() {
        match ops.pcap_check_support() {
            Ok(devs) => {
                out.extend(Formatter::format_pcap_interfaces(&devs));
                if !check && interface.is_none() {
                    out.push(Line::default());
                    out.push(Formatter::format_notice(
                        "To capture: /pcap <iface> [--filter <expr>] [--duration <secs>] [--output <file>] [--max-packets <n>]",
                    ));
                }
            }
            Err(e) => {
                out.push(Formatter::format_error("PCAP is not available."));
                out.push(Line::from(format!("  {e}")));
                out.push(Line::default());
                if cfg!(windows) {
                    out.push(Line::from(
                        "Windows: install Npcap (admin required) and retry: /pcap --check",
                    ));
                } else {
                    out.push(Line::from(
                        "macOS/Linux: install libpcap and retry: /pcap --check",
                    ));
                }
                out.push(Line::from("See README.md -> PCAP Support (Optional)."));
            }
        }
        return out;
    }

    let iface = interface.unwrap_or_else(|| "unknown".to_string());
    match ops.pcap_check_support() {
        // Deliberately no name check here (B-12).
        //
        // This used to require exact string equality against a device name,
        // while `resolve_capture_device` in core also accepts case-insensitive
        // names, description substrings, GUIDs and IP addresses. The TUI
        // therefore rejected interfaces the CLI accepted, for the same
        // capture. Core owns resolution; letting it fail produces one
        // consistent error across both surfaces.
        Ok(_devs) => {}
        Err(e) => {
            out.push(Formatter::format_error("PCAP is not available."));
            out.push(Line::from(format!("  {e}")));
            out.push(Line::default());
            if cfg!(windows) {
                out.push(Line::from(
                    "Windows: install Npcap (admin required) and retry: /pcap --check",
                ));
            } else {
                out.push(Line::from(
                    "macOS/Linux: install libpcap and retry: /pcap --check",
                ));
            }
            out.push(Line::from("See README.md -> PCAP Support (Optional)."));
            return out;
        }
    }

    match ops
        .capture_pcap_async_with_cancel(iface, filter, duration, output, max_packets, pcap_cancel)
        .await
    {
        Ok(res) => {
            if let Some(db) = db {
                commands::db_add_scan_history_safe(
                    db,
                    "pcap",
                    res.duration.as_millis() as i64,
                    &res,
                )
                .await;
            }
            out.extend(Formatter::format_pcap_result(&res));
        }
        Err(e) => {
            out.push(Formatter::format_error(&format!("{e}")));
            out.push(Line::default());
            out.push(Line::from("Tip: run /pcap --check to verify interfaces."));
        }
    }

    out
}
