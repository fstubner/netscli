use super::CommandContext;
use crate::args::ListOutput;
use crate::output::{emit, list_output_format, print_structured, OutputFormat};
use anyhow::Result;
use netscli_core::sanitize_for_terminal;
use std::time::Duration;

pub(super) async fn run(
    ctx: CommandContext<'_>,
    timeout_ms: u64,
    service_types: &[String],
    flags: ListOutput,
) -> Result<()> {
    let format = list_output_format(flags)?;
    let services = ctx
        .ops
        .discover_mdns(service_types, Duration::from_millis(timeout_ms))
        .await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
            print_structured(format, &services)?
        }
        OutputFormat::Text => emit(&format_services(timeout_ms, &services))?,
    }
    Ok(())
}

/// The services as the text output shows them, one block per host.
///
/// `timeout_ms` is what was asked for. Core waits at most
/// `MAX_MDNS_TIMEOUT_MS`, so the "found nothing" line names the wait that
/// happened, which is not always the one that was asked for.
fn format_services(timeout_ms: u64, services: &[netscli_core::MdnsService]) -> String {
    if services.is_empty() {
        let waited = timeout_ms.min(netscli_core::MAX_MDNS_TIMEOUT_MS);
        return format!("No mDNS services found within {waited}ms.");
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
    let mut lines = Vec::new();
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
        lines.push(format!("{host}  [{addr_list}]"));
        for svc in svcs {
            lines.push(format!(
                "  {} :{}",
                sanitize_for_terminal(svc.service_type.trim_end_matches('.')),
                svc.port
            ));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use netscli_core::MdnsService;
    use std::collections::HashMap;

    fn service(hostname: &str, service_type: &str, port: u16) -> MdnsService {
        MdnsService {
            full_name: format!("device.{service_type}"),
            hostname: hostname.to_string(),
            service_type: service_type.to_string(),
            addresses: vec!["10.0.0.9".parse().unwrap()],
            port,
            properties: HashMap::new(),
        }
    }

    #[test]
    fn finding_nothing_names_the_wait_that_happened() {
        assert_eq!(
            format_services(3000, &[]),
            "No mDNS services found within 3000ms."
        );
        // Core cuts a long wait to its maximum, so that is what was waited.
        let waited = netscli_core::MAX_MDNS_TIMEOUT_MS;
        assert_eq!(
            format_services(86_400_000, &[]),
            format!("No mDNS services found within {waited}ms.")
        );
    }

    #[test]
    fn services_group_under_their_host() {
        let text = format_services(
            3000,
            &[
                service("printer.local.", "_ipp._tcp.local.", 631),
                service("printer.local.", "_http._tcp.local.", 80),
            ],
        );
        assert_eq!(
            text,
            "printer.local.  [10.0.0.9]\n  _ipp._tcp.local :631\n  _http._tcp.local :80"
        );
    }

    #[test]
    fn a_device_cannot_send_escape_sequences_in_its_name() {
        let text = format_services(
            3000,
            &[service(
                "evil\u{1b}[2J\u{202E}.local.",
                "_x\u{1b}]52;c;AA==\u{7}._tcp.local.",
                1,
            )],
        );
        assert!(!text.contains('\u{1b}') && !text.contains('\u{7}'));
        assert!(!text.contains('\u{202E}'));
    }
}
