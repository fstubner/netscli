//! TUI slash-command dispatch.
//!
//! `handle_command` is invoked by the TUI's main event loop in
//! [`crate::tui::run_tui`] whenever the user submits a `/foo`-prefixed
//! line. It parses the command, runs the matching `commands::run_*`
//! against the shared `Ops` instance, persists results to the history
//! database (if available), and returns a `Vec<Line<'static>>` ready for
//! the TUI history pane.
//!
//! Originally lived in `main.rs` as `handle_tui_command`; moved here so
//! the TUI's slash-command surface lives next to the rest of the TUI
//! module instead of inflating `main.rs`. The function logic and
//! signature are unchanged — only the home location and the name (now
//! `handle_command` to match its module path).
use crate::commands;
use crate::tui_formatter::Formatter;
use netscli_core::{
    parse_ports_checked, Database, NetworkManager, Ops, PcapCancelToken, PingScanner,
};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Instant;
use tokio::sync::watch;

pub async fn handle_command(
    input: String,
    ops: &Ops,
    db: Option<&Database>,
    pcap_cancel: Option<PcapCancelToken>,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let parts: Vec<&str> = input.split_whitespace().collect();
    if parts.is_empty() {
        return out;
    }
    match parts[0] {
        "/discover" => {
            let subnet = parts.get(1).map(|s| s.to_string());
            let progress_cb = progress.clone().map(|tx| {
                let last_sent = std::sync::Arc::new(std::sync::Mutex::new(
                    Instant::now() - std::time::Duration::from_secs(1),
                ));
                std::sync::Arc::new(move |p: netscli_core::DiscoverProgress| {
                    let now = Instant::now();
                    let mut last = last_sent.lock().unwrap_or_else(|e| e.into_inner());
                    if now.duration_since(*last) < std::time::Duration::from_millis(80)
                        && p.completed < p.total
                    {
                        return;
                    }
                    *last = now;

                    let (phase, label) = match p.phase {
                        netscli_core::DiscoverPhase::Ping => ("ping", "alive"),
                        netscli_core::DiscoverPhase::Resolve => ("resolve", "resolved"),
                    };
                    let msg = format!(
                        "{phase} {}/{} \u{2022} {label} {} \u{2022} {}",
                        p.completed, p.total, p.found, p.ip
                    );
                    let _ = tx.send(msg);
                })
                    as std::sync::Arc<dyn Fn(netscli_core::DiscoverProgress) + Send + Sync>
            });

            match commands::run_discover(ops, db, subnet, true, progress_cb).await {
                Ok((_subnet, hosts)) => {
                    out.extend(Formatter::format_discovered_hosts(&hosts));
                }
                Err(e) => out.push(Formatter::format_error(&format!("{e}"))),
            }
        }
        "/scan" => {
            if let Some(host) = parts.get(1) {
                let ports = match parse_ports_checked(parts.get(2).copied()) {
                    Ok(ports) => ports,
                    Err(e) => {
                        out.push(Formatter::format_error(&format!("{e}")));
                        return out;
                    }
                };
                let progress_cb = progress.clone().map(|tx| {
                    let last_sent = std::sync::Arc::new(std::sync::Mutex::new(
                        Instant::now() - std::time::Duration::from_secs(1),
                    ));
                    std::sync::Arc::new(move |p: netscli_core::PortScanProgress| {
                        let now = Instant::now();
                        let mut last = last_sent.lock().unwrap_or_else(|e| e.into_inner());
                        if now.duration_since(*last) < std::time::Duration::from_millis(60)
                            && p.completed < p.total
                        {
                            return;
                        }
                        *last = now;

                        let open_suffix = if p.open { " (OPEN)" } else { "" };
                        let msg = format!(
                            "ports {}/{} \u{2022} port {}{} \u{2022} open {}",
                            p.completed, p.total, p.port, open_suffix, p.open_found
                        );
                        let _ = tx.send(msg);
                    })
                        as std::sync::Arc<dyn Fn(netscli_core::PortScanProgress) + Send + Sync>
                });

                match ops.scan_ports_with_progress(host, ports, progress_cb).await {
                    Ok((ip, res)) => {
                        if let Some(db) = db {
                            commands::db_add_scan_history_safe(db, "scan", 0, &res).await;
                        }

                        let arp = netscli_core::NetworkManager::find_mac(&ip);
                        let mac = arp.as_ref().map(|e| e.mac.to_string());
                        let vendor = arp.and_then(|e| e.vendor);
                        let hostname = netscli_core::dns::reverse_lookup_best_effort_timeout(
                            ip,
                            netscli_core::DEFAULT_DNS_TIMEOUT_MS,
                        )
                        .await;

                        out.extend(Formatter::format_scan_target_card(
                            ip, hostname, mac, vendor, false,
                        ));
                        out.push(Line::default());
                        out.extend(Formatter::format_scan_results(&res));
                    }
                    Err(e) => out.push(Formatter::format_error(&format!("{e}"))),
                }
            } else {
                out.push(Formatter::format_error("Usage: /scan <host> [ports]"));
            }
        }
        "/inspect" => {
            if let Some(host) = parts.get(1) {
                let ports = match parse_ports_checked(parts.get(2).copied()) {
                    Ok(ports) => ports,
                    Err(e) => {
                        out.push(Formatter::format_error(&format!("{e}")));
                        return out;
                    }
                };
                match commands::run_inspect(ops, db, host.to_string(), ports).await {
                    Ok(res) => {
                        out.extend(Formatter::format_inspect_result(&res));
                    }
                    Err(e) => out.push(Formatter::format_error(&format!("Error: {}", e))),
                }
            } else {
                out.push(Formatter::format_error("Usage: /inspect <host> [ports]"));
            }
        }
        "/sweep" => {
            // Resolve flags: default OFF to match the CLI `sweep` subcommand.
            // `--resolve`/`-r` opts in; `--no-resolve` is accepted for
            // backwards-compatibility (and to document the intent explicitly).
            let resolve = parts.iter().any(|p| *p == "--resolve" || *p == "-r")
                && !parts.contains(&"--no-resolve");
            let args: Vec<&str> = parts
                .iter()
                .skip(1)
                .filter(|p| **p != "--resolve" && **p != "-r" && **p != "--no-resolve")
                .copied()
                .collect();
            let ports = match parse_ports_checked(args.get(1).copied()) {
                Ok(ports) => ports,
                Err(e) => {
                    out.push(Formatter::format_error(&format!("{e}")));
                    return out;
                }
            };
            let ports_for_display = ports.clone().unwrap_or_else(netscli_core::default_ports);
            let subnet = args.first().map(|s| (*s).to_string());
            let progress_cb = progress.clone().map(|tx| {
                let last_sent = std::sync::Arc::new(std::sync::Mutex::new(
                    Instant::now() - std::time::Duration::from_secs(1),
                ));
                std::sync::Arc::new(move |p: netscli_core::SweepProgress| {
                    let now = Instant::now();
                    let mut last = last_sent.lock().unwrap_or_else(|e| e.into_inner());
                    if now.duration_since(*last) < std::time::Duration::from_millis(80)
                        && p.completed < p.total
                    {
                        return;
                    }
                    *last = now;

                    let msg = match p.phase {
                        netscli_core::SweepPhase::DiscoverPing => format!(
                            "discover ping {}/{} \u{2022} alive {} \u{2022} {}",
                            p.completed, p.total, p.found, p.ip
                        ),
                        netscli_core::SweepPhase::DiscoverResolve => format!(
                            "discover resolve {}/{} \u{2022} resolved {} \u{2022} {}",
                            p.completed, p.total, p.found, p.ip
                        ),
                        netscli_core::SweepPhase::Scan => format!(
                            "scan {}/{} \u{2022} open-hosts {} \u{2022} {}",
                            p.completed, p.total, p.found, p.ip
                        ),
                    };
                    let _ = tx.send(msg);
                })
                    as std::sync::Arc<dyn Fn(netscli_core::SweepProgress) + Send + Sync>
            });

            match commands::run_sweep(ops, db, subnet, ports, resolve, progress_cb).await {
                Ok((subnet_str, entries)) => {
                    if entries.is_empty() {
                        out.push(Formatter::format_notice(&format!(
                            "No hosts found in subnet {subnet_str}"
                        )));
                        return out;
                    }

                    let hosts_with_open =
                        entries.iter().filter(|e| !e.open_ports.is_empty()).count();
                    out.extend(Formatter::format_sweep_summary(
                        &subnet_str,
                        &ports_for_display,
                        entries.len(),
                        hosts_with_open,
                    ));

                    for (i, entry) in entries.iter().enumerate() {
                        if i > 0 {
                            out.push(Line::default());
                        }
                        let host = &entry.host;
                        out.extend(Formatter::format_scan_target_card(
                            host.ip,
                            host.hostname.clone(),
                            host.mac.clone(),
                            host.vendor.clone(),
                            true,
                        ));
                        out.push(Formatter::format_open_ports_inline(&entry.open_ports));
                    }
                }
                Err(e) => out.push(Formatter::format_error(&format!("{e}"))),
            }
        }
        "/dns" => {
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
        }
        "/reverse" => {
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
        }
        "/ping" => {
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
        }
        "/trace" => {
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

            match crate::trace::trace_route(&host, max_hops, resolve, progress.clone()).await {
                Ok(res) => {
                    out.push(Line::from(format!("Trace ({})", res.tool)));
                    out.push(Line::default());
                    for l in res.lines {
                        out.push(Line::from(l));
                    }
                }
                Err(e) => out.push(Formatter::format_error(&format!("{e}"))),
            }
        }
        "/arp" => match parts.get(1) {
            Some(&"add") if parts.len() >= 4 => {
                let ip: IpAddr = match parts[2].parse() {
                    Ok(ip) => ip,
                    Err(_) => {
                        out.push(Formatter::format_error(
                            "Invalid IP (usage: /arp add <ip> <mac>)",
                        ));
                        return out;
                    }
                };
                if let Ok(mac) = mac_address::MacAddress::from_str(parts[3]) {
                    match NetworkManager::add_entry(ip, mac) {
                        Ok(_) => out.push(Line::from(format!("Added ARP {}", ip))),
                        Err(e) => out.push(Formatter::format_error(&format!("Error: {}", e))),
                    }
                } else {
                    out.push(Formatter::format_error("Invalid MAC"));
                }
            }
            Some(&"del") if parts.len() >= 3 => {
                if let Ok(ip) = parts[2].parse() {
                    match NetworkManager::delete_entry(ip) {
                        Ok(_) => out.push(Line::from(format!("Deleted {}", ip))),
                        Err(e) => out.push(Formatter::format_error(&format!("Error: {}", e))),
                    }
                } else {
                    out.push(Formatter::format_error("Invalid IP"));
                }
            }
            Some(&"clear") => match NetworkManager::clear_table() {
                Ok(_) => out.push(Line::from("Cleared ARP table")),
                Err(e) => out.push(Formatter::format_error(&format!("Error: {}", e))),
            },
            _ => match ops.get_arp_table() {
                Ok(entries) => {
                    out.extend(Formatter::format_arp_table(&entries));
                }
                Err(e) => out.push(Formatter::format_error(&format!("Error: {e}"))),
            },
        },
        "/interfaces" => {
            let ifaces = ops.list_interfaces();
            out.extend(Formatter::format_interfaces(&ifaces));
        }
        "/mdns" => {
            // Parse optional --timeout <ms>; defaults to 3000.
            let mut timeout_ms: u64 = 3000;
            let mut i = 1usize;
            while i < parts.len() {
                match parts[i] {
                    "--timeout" | "-t" => {
                        if let Some(v) = parts.get(i + 1).and_then(|s| s.parse::<u64>().ok()) {
                            timeout_ms = v.clamp(100, 30_000);
                            i += 2;
                            continue;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            if let Some(tx) = &progress {
                let _ = tx.send(format!("Browsing mDNS for {timeout_ms}ms..."));
            }
            match ops
                .discover_mdns(&[], std::time::Duration::from_millis(timeout_ms))
                .await
            {
                Ok(services) => {
                    if services.is_empty() {
                        out.push(Formatter::format_notice(&format!(
                            "No mDNS services found within {timeout_ms}ms."
                        )));
                    } else {
                        // Device-centric grouping: one header per host, service list below.
                        let mut by_host: std::collections::BTreeMap<
                            String,
                            Vec<&netscli_core::MdnsService>,
                        > = std::collections::BTreeMap::new();
                        for svc in &services {
                            by_host.entry(svc.hostname.clone()).or_default().push(svc);
                        }
                        for (host, svcs) in by_host {
                            let addrs: std::collections::BTreeSet<String> = svcs
                                .iter()
                                .flat_map(|s| s.addresses.iter().map(|a| a.to_string()))
                                .collect();
                            let addr_list = if addrs.is_empty() {
                                String::from("no resolved addresses")
                            } else {
                                addrs.into_iter().collect::<Vec<_>>().join(", ")
                            };
                            out.push(Line::from(format!("{host}  [{addr_list}]")));
                            for svc in svcs {
                                out.push(Line::from(format!(
                                    "  {} :{}",
                                    svc.service_type.trim_end_matches('.'),
                                    svc.port
                                )));
                            }
                        }
                    }
                }
                Err(e) => out.push(Formatter::format_error(&format!("Error: {e}"))),
            }
        }
        "/pcap" => {
            #[cfg(not(feature = "pcap"))]
            {
                let _ = pcap_cancel;
                out.push(Formatter::format_notice(
                    "PCAP capture isn't available in this build.",
                ));
                out.push(Line::default());
                out.push(Line::from(
                    "Install a pcap-enabled build (NETSCLI_PCAP=1) or build from source with --features pcap.",
                ));
                out.push(Line::from("Then run: /pcap --check"));
                out.push(Line::from("See README.md -> PCAP Support (Optional)."));
                return out;
            }

            #[cfg(feature = "pcap")]
            {
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
                                out.push(Formatter::format_error(
                                    "Missing value for --max-packets",
                                ));
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
                    Ok(devs) => {
                        if !devs.iter().any(|d| d == &iface) {
                            out.push(Formatter::format_error(&format!(
                                "Unknown interface: {iface}"
                            )));
                            out.push(Line::default());
                            out.extend(Formatter::format_pcap_interfaces(&devs));
                            return out;
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
                        return out;
                    }
                }
                match ops
                    .capture_pcap_async_with_cancel(
                        iface,
                        filter,
                        duration,
                        output,
                        max_packets,
                        pcap_cancel,
                    )
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
            }
        }
        "/help" => {
            out.extend(crate::tui::help_lines());
        }
        "/quit" | "/exit" => {}
        other => {
            out.push(Formatter::format_error(&format!(
                "Unknown command: {}",
                other
            )));
        }
    }
    out
}
