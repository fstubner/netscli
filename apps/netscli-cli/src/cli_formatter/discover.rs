use netscli_core::discover::Host;
use netscli_core::sanitize_for_terminal;
use std::time::Instant;

use super::style::{cyan, dim, duration_tag, green, source_tag, white, yellow};
use super::table::column_width;
use super::CliFormatter;

impl CliFormatter {
    pub fn format_discover_result(
        hosts: &[Host],
        subnet: &str,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        let mut header_parts = vec![format!(
            "{} in subnet {}",
            green(&format!("Discovered {} hosts", hosts.len())),
            cyan(subnet)
        )];
        if let Some(tag) = duration_tag(start_time) {
            header_parts.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            header_parts.push(src);
        }

        format!(
            "{}\n\n{}",
            header_parts.join(" "),
            Self::format_discover_table(hosts)
        )
    }

    fn format_discover_table(hosts: &[Host]) -> String {
        if hosts.is_empty() {
            return dim("No hosts found.");
        }

        let ip_w = column_width(hosts.iter().map(|h| h.ip.to_string().len()), 16, 39);
        let mac_w = column_width(
            hosts.iter().map(|h| h.mac.as_deref().map_or(1, str::len)),
            18,
            18,
        );
        let vendor_w = column_width(
            hosts
                .iter()
                .map(|h| h.vendor.as_deref().map_or(1, str::len)),
            12,
            24,
        );
        let hostname_w = column_width(
            hosts
                .iter()
                .map(|h| h.hostname.as_deref().map_or(1, str::len)),
            8,
            40,
        );

        let header = dim(&format!(
            "{:<ipw$} {:<macw$} {:<venw$} {:<hostw$}",
            "IP Address",
            "MAC Address",
            "Vendor",
            "Hostname",
            ipw = ip_w,
            macw = mac_w,
            venw = vendor_w,
            hostw = hostname_w
        ));
        let separator = dim(&format!(
            "{} {} {} {}",
            "-".repeat(ip_w),
            "-".repeat(mac_w),
            "-".repeat(vendor_w),
            "-".repeat(hostname_w)
        ));

        let mut rows = vec![header, separator];
        for host in hosts {
            let ip_str = host.ip.to_string();
            let mac = host.mac.as_deref().unwrap_or("-");
            let vendor = host.vendor.as_deref().unwrap_or("-");
            // Hostnames are remote-chosen. `normalize_hostname` in core now
            // rejects control characters at the source, so this is the second
            // layer — it holds no matter which code path produced the name,
            // which is the property that was missing when the sanitiser was
            // wired to DNS records and mDNS names but to no hostname at all.
            let hostname = sanitize_for_terminal(host.hostname.as_deref().unwrap_or("-"));

            rows.push(format!(
                "{} {} {} {}",
                cyan(&format!("{:<w$}", ip_str, w = ip_w)),
                yellow(&format!("{:<w$}", mac, w = mac_w)),
                if vendor == "-" {
                    dim(&format!("{:<w$}", vendor, w = vendor_w))
                } else {
                    green(&format!("{:<w$}", vendor, w = vendor_w))
                },
                white(&format!("{:<w$}", hostname, w = hostname_w))
            ));
        }
        rows.join("\n")
    }
}
