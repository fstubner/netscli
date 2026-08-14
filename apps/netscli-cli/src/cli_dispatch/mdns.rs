use super::CommandContext;
use crate::output::{output_format, print_structured, OutputFormat};
use anyhow::Result;
use netscli_core::sanitize_for_terminal;
use std::time::Duration;

pub(super) async fn run(
    ctx: CommandContext<'_>,
    timeout_ms: u64,
    service_types: &[String],
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let services = ctx
        .ops
        .discover_mdns(service_types, Duration::from_millis(timeout_ms))
        .await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &services)?,
        OutputFormat::Text => print_services(timeout_ms, &services),
    }
    Ok(())
}

fn print_services(timeout_ms: u64, services: &[netscli_core::MdnsService]) {
    if services.is_empty() {
        println!("No mDNS services found within {timeout_ms}ms.");
        return;
    }

    // Hostnames and service types come from unauthenticated multicast
    // announcements — any device on the link picks its own, and mdns-sd
    // only escapes `.` and `\`. Sanitize before these reach the terminal.
    let mut by_host: std::collections::BTreeMap<String, Vec<&netscli_core::MdnsService>> =
        std::collections::BTreeMap::new();
    for svc in services {
        by_host
            .entry(sanitize_for_terminal(&svc.hostname).into_owned())
            .or_default()
            .push(svc);
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
                sanitize_for_terminal(svc.service_type.trim_end_matches('.')),
                svc.port
            );
        }
    }
}
