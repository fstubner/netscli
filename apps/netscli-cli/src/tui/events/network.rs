use crate::tui_formatter::Formatter;
use netscli_core::{NetworkManager, Ops};
use ratatui::text::Line;
use std::net::IpAddr;
use std::str::FromStr;
use tokio::sync::watch;

pub(super) async fn handle_arp(parts: &[&str], ops: &Ops) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    match parts.get(1) {
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
        _ => match ops.get_arp_table().await {
            Ok(entries) => {
                out.extend(Formatter::format_arp_table(&entries));
            }
            Err(e) => out.push(Formatter::format_error(&format!("Error: {e}"))),
        },
    }
    out
}

pub(super) fn handle_interfaces(ops: &Ops) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let ifaces = ops.list_interfaces();
    out.extend(Formatter::format_interfaces(&ifaces));
    out
}

pub(super) async fn handle_mdns(
    parts: &[&str],
    ops: &Ops,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
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
    out
}
