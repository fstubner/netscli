use crate::commands;
use crate::tui_formatter::Formatter;
use netscli_core::{parse_ports_checked, Database, Ops};
use ratatui::text::Line;
use std::time::Instant;
use tokio::sync::watch;

pub(super) async fn handle_discover(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let subnet = parts.get(1).map(|s| s.to_string());
    let progress_cb = progress.map(|tx| {
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
        }) as std::sync::Arc<dyn Fn(netscli_core::DiscoverProgress) + Send + Sync>
    });

    match commands::run_discover(ops, db, subnet, true, progress_cb).await {
        Ok((subnet_str, hosts)) => {
            out.extend(Formatter::format_discover_summary(
                &subnet_str,
                true,
                hosts.len(),
            ));
            out.extend(Formatter::format_discovered_hosts(&hosts));
        }
        Err(e) => out.push(Formatter::format_error(&format!("{e}"))),
    }
    out
}

pub(super) async fn handle_scan(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    if let Some(host) = parts.get(1) {
        let ports = match parse_ports_checked(parts.get(2).copied()) {
            Ok(ports) => ports,
            Err(e) => {
                out.push(Formatter::format_error(&format!("{e}")));
                return out;
            }
        };
        let progress_cb = progress.map(|tx| {
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
            }) as std::sync::Arc<dyn Fn(netscli_core::PortScanProgress) + Send + Sync>
        });

        match ops.scan_ports_with_progress(host, ports, progress_cb).await {
            Ok((ip, res)) => {
                if let Some(db) = db {
                    commands::db_add_scan_history_safe(db, "scan", 0, &res).await;
                }

                // `find_mac` shells out to `arp` on Windows and macOS, so
                // calling it inline blocked a tokio worker for the lifetime
                // of a subprocess (B-10).
                let arp = tokio::task::spawn_blocking(move || {
                    netscli_core::NetworkManager::find_mac(&ip)
                })
                .await
                .unwrap_or(None);
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
    out
}

pub(super) async fn handle_inspect(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
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
    out
}

pub(super) async fn handle_sweep(
    parts: &[&str],
    ops: &Ops,
    db: Option<&Database>,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    // Resolve flags: default OFF to match the CLI `sweep` subcommand.
    // `--resolve`/`-r` opts in; `--no-resolve` is accepted for
    // backwards-compatibility (and to document the intent explicitly).
    let resolve =
        parts.iter().any(|p| *p == "--resolve" || *p == "-r") && !parts.contains(&"--no-resolve");
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
    let progress_cb = progress.map(|tx| {
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
        }) as std::sync::Arc<dyn Fn(netscli_core::SweepProgress) + Send + Sync>
    });

    match commands::run_sweep(ops, db, subnet, ports, resolve, progress_cb).await {
        Ok((subnet_str, entries)) => {
            if entries.is_empty() {
                out.push(Formatter::format_notice(&format!(
                    "No hosts found in subnet {subnet_str}"
                )));
                return out;
            }

            let hosts_with_open = entries.iter().filter(|e| !e.open_ports.is_empty()).count();
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
    out
}
