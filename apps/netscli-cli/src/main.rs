#![allow(clippy::uninlined_format_args)]

mod args;
mod cli_formatter;
mod commands;
mod mcp_service;
mod setup;
mod trace;
mod tui;
mod tui_export;
mod tui_formatter;
mod tui_settings;

use anyhow::{Context, Result};
use args::{Cli, Commands};
use clap::Parser;
use cli_formatter::CliFormatter;
use mac_address::MacAddress;
use netscli_core::{parse_ports_checked, NetworkManager, Ops, OpsConfig, DEFAULT_CONCURRENCY};
use serde::Serialize;
use std::io;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Instant;

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

    let db = commands::try_init_db().await;
    let ops = Ops::new(OpsConfig {
        concurrency: cli.concurrency.unwrap_or(DEFAULT_CONCURRENCY),
        ..Default::default()
    });
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
                    commands::run_discover(&ops, db.as_ref(), subnet.clone(), *resolve, None)
                        .await?;
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
                let results = commands::run_scan(&ops, db.as_ref(), host, ports).await?;
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
                let data = commands::run_inspect(&ops, db.as_ref(), host.clone(), ports).await?;
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
                    commands::run_sweep(&ops, db.as_ref(), subnet.clone(), ports, *resolve, None)
                        .await?;
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
                let records = commands::run_dns(&ops, db.as_ref(), host, record.clone()).await?;
                match format {
                    OutputFormat::Json | OutputFormat::Yaml => {
                        print_structured(format, &records)?;
                    }
                    OutputFormat::Text => {
                        commands::print_dns_records_text(&records);
                    }
                }
            }
            Commands::Reverse { ip, json, yaml } => {
                let format = output_format(*json, *yaml)?;
                let res = commands::run_reverse(&ops, db.as_ref(), ip).await?;
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
                    commands::db_add_scan_history_safe(
                        db,
                        "pcap",
                        res.duration.as_millis() as i64,
                        &res,
                    )
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
        tui::run_tui(cli.concurrency.unwrap_or(DEFAULT_CONCURRENCY)).await?;
    }

    Ok(())
}

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).
