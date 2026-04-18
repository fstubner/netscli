#![allow(clippy::uninlined_format_args)]

mod args;
mod cli_formatter;
mod formatter;
mod mcp_service;
mod setup;
mod trace;
mod tui;
mod tui_export;
mod tui_settings;

use anyhow::{Context, Result};
use args::{Cli, Commands};
use clap::Parser;
use cli_formatter::CliFormatter;
use crossterm::{
    cursor::Show,
    event::{self, DisableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode},
};
use dirs::home_dir;
use formatter::Formatter;
use mac_address::MacAddress;
use netscli_core::{
    parse_ports_checked, Database, NetworkManager, Ops, PcapCancelToken, PingScanner,
};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::{backend::CrosstermBackend, Terminal};
use serde::Serialize;
use std::collections::HashMap;
use std::io;
use std::net::IpAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Instant;
use tokio::sync::watch;
use tui::TuiApp;

struct TerminalCleanup;

impl Drop for TerminalCleanup {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let mut stdout = io::stdout();
        let _ = execute!(stdout, DisableMouseCapture, Show);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputFormat {
    Text,
    Json,
    Yaml,
}

fn output_format(json: bool, yaml: bool) -> Result<OutputFormat> {
    if json && yaml {
        anyhow::bail!("Use only one of --json or --yaml");
    }
    if yaml {
        Ok(OutputFormat::Yaml)
    } else if json {
        Ok(OutputFormat::Json)
    } else {
        Ok(OutputFormat::Text)
    }
}

fn print_structured<T: Serialize>(format: OutputFormat, value: &T) -> Result<()> {
    match format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(value)?),
        OutputFormat::Yaml => println!("{}", serde_yaml_ng::to_string(value)?),
        OutputFormat::Text => {}
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // First-run hint on TUI launch. CLI subcommands stay silent so piped
    // output (`netscli scan host --json | jq`) isn't polluted with hints.
    if cli.command.is_none() && !setup::config_exists() {
        #[cfg(feature = "pcap")]
        eprintln!("netscli: first run detected. Type `/help` for commands, or run `netscli setup` to install optional dependencies (libpcap, tcpdump).");
        #[cfg(not(feature = "pcap"))]
        eprintln!("netscli: first run detected. Type `/help` for commands. (This build has pcap disabled — rebuild with --features pcap to enable capture.)");
    }

    let db = try_init_db().await;
    let ops = Ops::default();
    let local_addr = netscli_core::detect_default_ipv4_addr().map(|ip| ip.to_string());

    if let Some(command) = &cli.command {
        // CLI Mode execution logic
        match command {
            Commands::Setup { print, execute } => {
                setup::run_setup(*execute, *print).await?;
                return Ok(());
            }
            Commands::Doctor { json, yaml } => {
                setup::print_status(*json, *yaml).await?;
                return Ok(());
            }
            Commands::Discover {
                subnet,
                resolve,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let start = Instant::now();
                let (subnet_str, hosts) =
                    run_discover(&ops, db.as_ref(), subnet.clone(), *resolve, None).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &hosts)?,
                    OutputFormat::Text => {
                        println!(
                            "{}",
                            CliFormatter::format_discover_result(
                                &hosts,
                                &subnet_str,
                                start,
                                local_addr.as_deref()
                            )
                        );
                    }
                }
            }
            Commands::Scan {
                host,
                ports,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let start = Instant::now();
                let ports = parse_ports_checked(ports.as_deref())?;
                let results = run_scan(&ops, db.as_ref(), host, ports).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => {
                        let open: Vec<_> = results.iter().filter(|p| p.open).cloned().collect();
                        print_structured(format, &open)?;
                    }
                    OutputFormat::Text => {
                        println!(
                            "{}",
                            CliFormatter::format_scan_result(
                                &results,
                                host,
                                start,
                                local_addr.as_deref()
                            )
                        );
                    }
                }
            }
            Commands::Inspect {
                host,
                ports,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let start = Instant::now();
                let ports = parse_ports_checked(ports.as_deref())?;
                let data = run_inspect(&ops, db.as_ref(), host.clone(), ports).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &data)?,
                    OutputFormat::Text => {
                        println!(
                            "{}",
                            CliFormatter::format_inspect_result(
                                &data,
                                start,
                                local_addr.as_deref()
                            )
                        );
                    }
                }
            }
            Commands::Sweep {
                subnet,
                ports,
                resolve,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let start = Instant::now();
                let ports = parse_ports_checked(ports.as_deref())?;
                let (subnet_str, results) =
                    run_sweep(&ops, db.as_ref(), subnet.clone(), ports, *resolve, None).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &results)?,
                    OutputFormat::Text => {
                        println!(
                            "{}",
                            CliFormatter::format_sweep_result(
                                &results,
                                &subnet_str,
                                start,
                                local_addr.as_deref()
                            )
                        );
                    }
                }
            }
            Commands::Dns {
                host,
                record,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let records = run_dns(&ops, db.as_ref(), host, record.clone()).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => {
                        print_structured(format, &records)?;
                    }
                    OutputFormat::Text => {
                        print_dns_records_text(&records);
                    }
                }
            }
            Commands::Reverse { ip, json, yaml } => {
                let format = output_format(*json, *yaml)?;
                let res = run_reverse(&ops, db.as_ref(), ip).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &res)?,
                    OutputFormat::Text => match res {
                        Some(name) => println!("{}", name),
                        None => println!("No PTR record found."),
                    },
                }
            }
            Commands::Ping {
                host,
                count,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let summary = ops.ping_host_summary(host, *count).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => {
                        print_structured(format, &summary)?;
                    }
                    OutputFormat::Text => {
                        println!("PING {} ({})", summary.host, summary.ip);
                        println!(
                            "sent={} received={} loss={:.1}%",
                            summary.sent, summary.received, summary.loss_pct
                        );
                        if let (Some(min), Some(max)) = (summary.rtt_ms_min, summary.rtt_ms_max) {
                            if let Some(avg) = summary.rtt_ms_avg {
                                println!("rtt min/avg/max = {min}/{avg:.1}/{max} ms");
                            }
                        }
                    }
                }
            }
            Commands::Trace {
                host,
                resolve,
                max_hops,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let res = crate::trace::trace_route(host, *max_hops, *resolve, None).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &res)?,
                    OutputFormat::Text => {
                        for line in res.lines {
                            println!("{line}");
                        }
                    }
                }
            }
            Commands::Arp {
                add,
                delete,
                clear,
                ip,
                mac,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;

                #[derive(Serialize)]
                struct ArpActionResult<'a> {
                    action: &'a str,
                    ip: Option<IpAddr>,
                    ok: bool,
                }

                if *clear {
                    NetworkManager::clear_table()?;
                    match format {
                        OutputFormat::Json | OutputFormat::Yaml => {
                            print_structured(
                                format,
                                &ArpActionResult {
                                    action: "clear",
                                    ip: None,
                                    ok: true,
                                },
                            )?;
                        }
                        OutputFormat::Text => println!("ARP table cleared"),
                    }
                    return Ok(());
                }
                if *add {
                    let ip = ip
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("Missing --ip for ARP add"))?;
                    let mac = mac
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("Missing --mac for ARP add"))?;
                    let ip: IpAddr = ip.parse()?;
                    let mac = MacAddress::from_str(mac)?;
                    NetworkManager::add_entry(ip, mac)?;
                    match format {
                        OutputFormat::Json | OutputFormat::Yaml => {
                            print_structured(
                                format,
                                &ArpActionResult {
                                    action: "add",
                                    ip: Some(ip),
                                    ok: true,
                                },
                            )?;
                        }
                        OutputFormat::Text => println!("ARP entry added for {}", ip),
                    }
                    return Ok(());
                }
                if *delete {
                    let ip = ip
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("Missing --ip for ARP delete"))?;
                    let ip: IpAddr = ip.parse()?;
                    NetworkManager::delete_entry(ip)?;
                    match format {
                        OutputFormat::Json | OutputFormat::Yaml => {
                            print_structured(
                                format,
                                &ArpActionResult {
                                    action: "delete",
                                    ip: Some(ip),
                                    ok: true,
                                },
                            )?;
                        }
                        OutputFormat::Text => println!("ARP entry deleted for {}", ip),
                    }
                    return Ok(());
                }

                let entries = ops.get_arp_table()?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &entries)?,
                    OutputFormat::Text => {
                        for e in entries {
                            let vendor = e.vendor.as_deref().unwrap_or("-");
                            println!("{} {} {} {}", e.ip, e.mac, e.interface, vendor);
                        }
                    }
                }
            }
            #[cfg(feature = "pcap")]
            Commands::Pcap {
                interface,
                filter,
                duration,
                max_packets,
                output,
                check,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                if *check {
                    let devs = ops.pcap_check_support()?;
                    match format {
                        OutputFormat::Json | OutputFormat::Yaml => {
                            print_structured(format, &devs)?;
                        }
                        OutputFormat::Text => {
                            println!("pcap available. Interfaces:");
                            for d in devs {
                                println!("  {}", d);
                            }
                        }
                    }
                    return Ok(());
                }

                // Not --check → --interface is required. clap's ArgGroup lets
                // you supply either, so we enforce the conditional here.
                let interface = interface.clone().ok_or_else(|| {
                    anyhow::anyhow!("--interface is required when not using --check")
                })?;

                let res = ops
                    .capture_pcap_async(
                        interface,
                        filter.clone(),
                        *duration,
                        Some(output.clone()),
                        *max_packets,
                    )
                    .await?;

                if let Some(db) = db.as_ref() {
                    db_add_scan_history_safe(db, "pcap", res.duration.as_millis() as i64, &res)
                        .await;
                }

                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &res)?,
                    OutputFormat::Text => {
                        println!(
                            "Captured {} packets to {:?}",
                            res.packets_captured, res.file_path
                        );
                    }
                }
            }
            Commands::Interfaces { json, yaml } => {
                let format = output_format(*json, *yaml)?;
                let ifaces = ops.list_interfaces();
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &ifaces)?,
                    OutputFormat::Text => {
                        for iface in ifaces {
                            println!(
                                "{} up={} loopback={}",
                                iface.name, iface.is_up, iface.is_loopback
                            );
                            for ip in iface.ips {
                                println!("  {}", ip);
                            }
                        }
                    }
                }
            }
            Commands::Mdns {
                timeout_ms,
                service_types,
                json,
                yaml,
            } => {
                let format = output_format(*json, *yaml)?;
                let services = ops
                    .discover_mdns(service_types, std::time::Duration::from_millis(*timeout_ms))
                    .await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &services)?,
                    OutputFormat::Text => {
                        if services.is_empty() {
                            println!("No mDNS services found within {timeout_ms}ms.");
                        } else {
                            // Group by hostname for a device-centric view.
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
                                println!("{host}  [{addr_list}]");
                                for svc in svcs {
                                    println!(
                                        "  {} :{}",
                                        svc.service_type.trim_end_matches('.'),
                                        svc.port
                                    );
                                }
                            }
                        }
                    }
                }
            }
            Commands::Completions { shell } => {
                use clap::CommandFactory;
                let mut cmd = Cli::command();
                let name = cmd.get_name().to_string();
                clap_complete::generate(*shell, &mut cmd, name, &mut io::stdout());
                return Ok(());
            }
            Commands::Man => {
                use clap::CommandFactory;
                let cmd = Cli::command();
                let man = clap_mangen::Man::new(cmd);
                man.render(&mut io::stdout())
                    .context("rendering man page")?;
                return Ok(());
            }
            Commands::McpServe => {
                netscli_mcp::run_server().await?;
            }
            Commands::McpService {
                install,
                uninstall,
                status,
            } => {
                if *install {
                    mcp_service::install_service()?;
                } else if *uninstall {
                    mcp_service::uninstall_service()?;
                } else if *status {
                    mcp_service::show_status()?;
                } else {
                    println!("Use --install, --uninstall, or --status");
                }
            }
        }
    } else {
        run_tui().await?;
    }

    Ok(())
}

fn warn_nonfatal(context: &str, err: impl std::fmt::Display) {
    eprintln!("netscli: warning: {context}: {err}");
}

async fn db_upsert_host_safe(
    db: &Database,
    mac: &str,
    ip: Option<&str>,
    hostname: Option<&str>,
    vendor: Option<&str>,
) {
    if let Err(e) = db.upsert_host(mac, ip, hostname, vendor).await {
        warn_nonfatal("db upsert_host failed", e);
    }
}

async fn db_add_scan_history_safe<T: Serialize>(
    db: &Database,
    command: &str,
    duration_ms: i64,
    value: &T,
) {
    match serde_json::to_string(value) {
        Ok(json) => {
            if let Err(e) = db.add_scan_history(command, duration_ms, &json).await {
                warn_nonfatal("db add_scan_history failed", e);
            }
        }
        Err(e) => warn_nonfatal("db failed to serialize scan history payload", e),
    }
}

async fn db_upsert_discovered_hosts_safe(db: &Database, hosts: &[netscli_core::Host]) {
    for h in hosts {
        if let Some(mac) = h.mac.as_deref() {
            db_upsert_host_safe(
                db,
                mac,
                Some(&h.ip.to_string()),
                h.hostname.as_deref(),
                h.vendor.as_deref(),
            )
            .await;
        }
    }
}

async fn db_upsert_sweep_hosts_safe(db: &Database, entries: &[netscli_core::SweepEntry]) {
    for entry in entries {
        if let Some(mac) = entry.host.mac.as_deref() {
            db_upsert_host_safe(
                db,
                mac,
                Some(&entry.host.ip.to_string()),
                entry.host.hostname.as_deref(),
                entry.host.vendor.as_deref(),
            )
            .await;
        }
    }
}

async fn run_discover(
    ops: &Ops,
    db: Option<&Database>,
    subnet: Option<String>,
    resolve: bool,
    progress: Option<std::sync::Arc<dyn Fn(netscli_core::DiscoverProgress) + Send + Sync>>,
) -> Result<(String, Vec<netscli_core::Host>)> {
    let (subnet_str, hosts) = ops
        .discover_ipv4_with_progress(subnet, resolve, progress)
        .await?;
    if let Some(db) = db {
        db_upsert_discovered_hosts_safe(db, &hosts).await;
        db_add_scan_history_safe(db, "discover", 0, &hosts).await;
    }
    Ok((subnet_str, hosts))
}

async fn run_scan(
    ops: &Ops,
    db: Option<&Database>,
    host: &str,
    ports: Option<Vec<u16>>,
) -> Result<Vec<netscli_core::PortResult>> {
    let (_ip, results) = ops.scan_ports(host, ports).await?;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "scan", 0, &results).await;
    }
    Ok(results)
}

async fn run_inspect(
    ops: &Ops,
    db: Option<&Database>,
    host: String,
    ports: Option<Vec<u16>>,
) -> Result<netscli_core::InspectResult> {
    let res = ops.inspect_host(host, ports).await?;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "inspect", 0, &res).await;
    }
    Ok(res)
}

async fn run_sweep(
    ops: &Ops,
    db: Option<&Database>,
    subnet: Option<String>,
    ports: Option<Vec<u16>>,
    resolve_hostnames: bool,
    progress: Option<std::sync::Arc<dyn Fn(netscli_core::SweepProgress) + Send + Sync>>,
) -> Result<(String, Vec<netscli_core::SweepEntry>)> {
    let (subnet_str, entries) = ops
        .sweep_ipv4_with_progress(subnet, ports, resolve_hostnames, progress)
        .await?;
    if let Some(db) = db {
        db_upsert_sweep_hosts_safe(db, &entries).await;
        db_add_scan_history_safe(db, "sweep", 0, &entries).await;
    }
    Ok((subnet_str, entries))
}

async fn run_dns(
    ops: &Ops,
    db: Option<&Database>,
    host: &str,
    record: Option<String>,
) -> Result<Vec<netscli_core::dns::DnsRecord>> {
    let records = ops.dns_lookup(host, record).await?;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "dns", 0, &records).await;
    }
    Ok(records)
}

fn print_dns_records_text(records: &[netscli_core::dns::DnsRecord]) {
    if records.is_empty() {
        println!("No DNS records found.");
        return;
    }

    let mut order: Vec<String> = Vec::new();
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    for record in records {
        if !grouped.contains_key(&record.record_type) {
            order.push(record.record_type.clone());
        }
        grouped
            .entry(record.record_type.clone())
            .or_default()
            .push(record.value.clone());
    }

    for (idx, record_type) in order.iter().enumerate() {
        if idx > 0 {
            println!();
        }
        println!("DNS {record_type}");
        if let Some(values) = grouped.get(record_type) {
            for value in values {
                println!("  {value}");
            }
        }
    }
}

async fn run_reverse(ops: &Ops, db: Option<&Database>, ip: &str) -> Result<Option<String>> {
    let ip: IpAddr = ip
        .parse()
        .context("Invalid IP address (expected IPv4 or IPv6)")?;
    let name =
        netscli_core::dns::reverse_lookup_best_effort_timeout(ip, ops.config().dns_timeout_ms)
            .await;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "reverse", 0, &name).await;
    }
    Ok(name)
}

async fn try_init_db() -> Option<Database> {
    match init_db().await {
        Ok(db) => Some(db),
        Err(e) => {
            eprintln!("netscli: warning: database unavailable ({e}); continuing without history");
            None
        }
    }
}

async fn init_db() -> Result<Database> {
    let base = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let db_path = base.join(".netscli").join("netscli.db");
    let parent = db_path
        .parent()
        .context("netscli db path has no parent directory")?;
    std::fs::create_dir_all(parent)?;
    let db = Database::new(db_path).await?;
    Ok(db)
}

async fn run_tui() -> Result<()> {
    let db = try_init_db().await.map(std::sync::Arc::new);
    enable_raw_mode()?;
    let stdout = io::stdout();
    // Render into the main terminal buffer so native scrollback/selection works.
    let _cleanup = TerminalCleanup;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = TuiApp::new();
    app.settings = crate::tui_settings::load_settings();
    app.apply_settings();
    let ops = Ops::default();
    let mut task: Option<tokio::task::JoinHandle<Vec<Line<'static>>>> = None;
    let tick_rate = std::time::Duration::from_millis(100);
    let mut last_nav_at: Option<Instant> = None;
    let mut exit_confirmed_at: Option<Instant> = None;
    let mut pcap_cancel: Option<PcapCancelToken> = None;
    let mut progress_rx: Option<watch::Receiver<String>> = None;

    loop {
        if app.confirm_exit {
            if let Some(at) = exit_confirmed_at {
                if at.elapsed() >= std::time::Duration::from_secs(3) {
                    app.confirm_exit = false;
                    app.set_status("ready");
                    exit_confirmed_at = None;
                }
            } else {
                exit_confirmed_at = Some(Instant::now());
            }
        } else {
            exit_confirmed_at = None;
        }

        if app.running {
            if let Some(rx) = &progress_rx {
                let msg = rx.borrow().clone();
                app.running_detail = if msg.trim().is_empty() {
                    None
                } else {
                    Some(msg)
                };
            } else {
                app.running_detail = None;
            }
        } else {
            app.running_detail = None;
            progress_rx = None;
        }

        app.draw(&mut terminal)?;
        if !app.running {
            app.update_suggestions();
        } else {
            app.suggestions.clear();
        }

        // If a background command finished, apply its output.
        if let Some(handle) = task.as_mut() {
            if handle.is_finished() {
                let handle = task.take().expect("task just checked as Some");
                match handle.await {
                    Ok(lines) => app.finish_current(lines),
                    Err(e) => {
                        if e.is_cancelled() {
                            app.finish_current(vec![Formatter::format_notice(
                                "Operation cancelled",
                            )]);
                        } else {
                            app.finish_current(vec![Formatter::format_error(&format!(
                                "Operation failed: {e}"
                            ))]);
                        }
                    }
                }
                app.running = false;
                app.set_status("ready");
                pcap_cancel = None;
                progress_rx = None;
            }
        }

        // Poll for input with a timeout so we can keep the UI updating while operations run.
        if event::poll(tick_rate)? {
            match event::read()? {
                Event::Resize(_, _) => {
                    // Redraw on next tick.
                }
                Event::Mouse(_) => {}
                Event::Key(key) => {
                    // Avoid double-processing keys on platforms that emit Release events.
                    if matches!(key.kind, KeyEventKind::Release) {
                        continue;
                    }

                    // Some terminals emit a Press + immediate Repeat for navigation keys.
                    // Debounce to ensure Up/Down move by 1 item.
                    if matches!(key.code, KeyCode::Up | KeyCode::Down) {
                        let now = Instant::now();
                        if last_nav_at.is_some_and(|prev| {
                            now.duration_since(prev) < std::time::Duration::from_millis(30)
                        }) {
                            continue;
                        }
                        last_nav_at = Some(now);
                    } else {
                        last_nav_at = None;
                    }

                    // While an operation is running, allow scrolling + cancel.
                    if app.running {
                        match key.code {
                            KeyCode::PageUp => app.scroll_up(6),
                            KeyCode::PageDown => app.scroll_down(6),
                            KeyCode::Home => app.scroll_up(u16::MAX),
                            KeyCode::End => app.scroll_to_bottom(),
                            _ => {}
                        }

                        let cancel = key.code == KeyCode::Esc
                            || (key.code == KeyCode::Char('c')
                                && key.modifiers.contains(KeyModifiers::CONTROL));
                        if cancel {
                            if let Some(cancel_token) = pcap_cancel.take() {
                                cancel_token.cancel();
                                if let Some(handle) = task.take() {
                                    match handle.await {
                                        Ok(lines) => app.finish_current(lines),
                                        Err(e) => {
                                            app.finish_current(vec![Formatter::format_error(
                                                &format!("Operation failed: {e}"),
                                            )])
                                        }
                                    }
                                }
                                app.running = false;
                                app.set_status("ready");
                                progress_rx = None;
                            } else if let Some(handle) = task.take() {
                                handle.abort();
                                let _ = handle.await;
                                app.running = false;
                                app.set_status("cancelled");
                                progress_rx = None;
                                app.finish_current(vec![Formatter::format_notice(
                                    "Operation cancelled",
                                )]);
                            }
                        }
                        continue;
                    }

                    if app.is_config_mode() {
                        match key.code {
                            KeyCode::Esc => {
                                app.exit_config();
                            }
                            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                                app.exit_config();
                            }
                            KeyCode::Up => app.config_prev(),
                            KeyCode::Down => app.config_next(),
                            KeyCode::Left => app.config_cycle(-1),
                            KeyCode::Right => app.config_cycle(1),
                            KeyCode::Enter => {
                                if app.config_activate() {
                                    app.exit_config();
                                }
                            }
                            KeyCode::PageUp => {
                                for _ in 0..4 {
                                    app.config_prev();
                                }
                            }
                            KeyCode::PageDown => {
                                for _ in 0..4 {
                                    app.config_next();
                                }
                            }
                            _ => {}
                        }
                        continue;
                    }

                    let is_ctrl_c = key.code == KeyCode::Char('c')
                        && key.modifiers.contains(KeyModifiers::CONTROL);
                    let is_exit_key = key.code == KeyCode::Esc || is_ctrl_c;

                    // Any non-exit key clears the exit-confirm prompt.
                    if app.confirm_exit && !is_exit_key {
                        app.confirm_exit = false;
                        app.set_status("ready");
                        exit_confirmed_at = None;
                    }

                    match key.code {
                        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            if app.confirm_exit {
                                break;
                            } else {
                                app.confirm_exit = true;
                                app.set_status("Press Esc or Ctrl+C again to exit");
                                exit_confirmed_at = Some(Instant::now());
                            }
                        }
                        KeyCode::Esc => {
                            if app.confirm_exit {
                                break;
                            } else {
                                app.confirm_exit = true;
                                app.set_status("Press Esc or Ctrl+C again to exit");
                                exit_confirmed_at = Some(Instant::now());
                            }
                        }
                        KeyCode::Tab => {
                            app.apply_tab_completion();
                        }
                        KeyCode::PageUp => app.scroll_up(6),
                        KeyCode::PageDown => app.scroll_down(6),
                        KeyCode::Home if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            app.scroll_up(u16::MAX)
                        }
                        KeyCode::End if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            app.scroll_to_bottom()
                        }
                        KeyCode::Up => {
                            let input = app.input.lines().join("\n");
                            let cmd = input.split_whitespace().next().unwrap_or("");
                            if !app.suggestions.is_empty() && !app.is_exact_command(cmd) {
                                app.navigate_suggestions(-1);
                            } else {
                                app.navigate_history(-1);
                            }
                        }
                        KeyCode::Down => {
                            let input = app.input.lines().join("\n");
                            let cmd = input.split_whitespace().next().unwrap_or("");
                            if !app.suggestions.is_empty() && !app.is_exact_command(cmd) {
                                app.navigate_suggestions(1);
                            } else {
                                app.navigate_history(1);
                            }
                        }
                        KeyCode::Enter => {
                            let raw = app.input.lines().join("\n");
                            let trimmed = raw.trim();
                            if !trimmed.is_empty() {
                                let mut input = trimmed.to_string();
                                if !app.suggestions.is_empty()
                                    && !trimmed.contains(' ')
                                    && trimmed.starts_with('/')
                                    && !app.is_exact_command(trimmed)
                                {
                                    if let Some(s) = app.selected_suggestion() {
                                        input = s.cmd.to_string();
                                    }
                                }

                                let first = input.split_whitespace().next().unwrap_or("");
                                if first == "/quit" || first == "/exit" {
                                    // Graceful shutdown: break so we can restore terminal state.
                                    break;
                                }

                                if first == "/config" {
                                    app.confirm_exit = false;
                                    app.set_status("ready");
                                    app.enter_config();
                                    app.reset_input();
                                    app.reset_history_nav();
                                    app.suggestions.clear();
                                    app.suggestion_index = 0;
                                    continue;
                                }

                                if first == "/export" {
                                    let snapshot = app.history.clone();
                                    let result = crate::tui_export::parse_export_command(&input)
                                        .and_then(|req| {
                                            crate::tui_export::export_session(&snapshot, &req)
                                        });

                                    app.confirm_exit = false;
                                    app.set_status("ready");
                                    app.push_command(input.clone());
                                    // Skip duplicate consecutive history entries so
                                    // repeated Enter presses don't bloat Up/Down nav.
                                    if app.command_history.last() != Some(&input) {
                                        app.command_history.push(input.clone());
                                    }
                                    app.reset_input();
                                    app.reset_history_nav();
                                    app.suggestions.clear();
                                    app.suggestion_index = 0;

                                    let lines = match result {
                                        Ok(path) => vec![Line::from(format!(
                                            "Exported to {}",
                                            path.display()
                                        ))],
                                        Err(e) => vec![
                                            Formatter::format_error(&format!("{e}")),
                                            Line::from(
                                                "Usage: /export [md|json] [--output <path>]",
                                            ),
                                        ],
                                    };
                                    app.finish_current(lines);
                                    continue;
                                }

                                app.confirm_exit = false;
                                app.running = true;
                                app.set_status("Running...");
                                app.push_command(input.clone());
                                if app.command_history.last() != Some(&input) {
                                    app.command_history.push(input.clone());
                                }
                                app.reset_input();
                                app.reset_history_nav();
                                app.suggestions.clear();
                                app.suggestion_index = 0;

                                let ops = ops.clone();
                                let db = db.clone();
                                let (progress_tx, rx) = watch::channel(String::new());
                                progress_rx = Some(rx);
                                let pcap_cancel_for_task = if first == "/pcap" {
                                    let token = PcapCancelToken::new();
                                    pcap_cancel = Some(token.clone());
                                    Some(token)
                                } else {
                                    pcap_cancel = None;
                                    None
                                };
                                task = Some(tokio::spawn(async move {
                                    handle_tui_command(
                                        input,
                                        &ops,
                                        db.as_deref(),
                                        pcap_cancel_for_task,
                                        Some(progress_tx),
                                    )
                                    .await
                                }));
                            }
                        }
                        _ => {
                            app.input.input(key);
                            app.reset_history_nav();
                            app.suggestion_index = 0;
                            app.confirm_exit = false;
                        }
                    }
                }
                _ => {}
            };
        }
    }

    Ok(())
}

async fn handle_tui_command(
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

            match run_discover(ops, db, subnet, true, progress_cb).await {
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
                            db_add_scan_history_safe(db, "scan", 0, &res).await;
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
                match run_inspect(ops, db, host.to_string(), ports).await {
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

            match run_sweep(ops, db, subnet, ports, resolve, progress_cb).await {
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
                match run_dns(ops, db, &host, record.clone()).await {
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
                match run_reverse(ops, db, raw_ip).await {
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
                            db_add_scan_history_safe(
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

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).
