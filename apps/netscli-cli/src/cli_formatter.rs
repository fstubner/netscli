//! Plain-text (ANSI-colored) CLI output formatter.
//!
//! Rewritten to fix a pervasive bug in the original: every header was built
//! as `format!("{}{}text{}", COLOR, RESET, text, RESET)` — the `RESET`
//! immediately after the opening color code killed the color before the
//! styled text could render. All formatting now goes through the `paint`
//! helper so the pattern is impossible to get wrong.
//!
//! Colors are suppressed entirely when stdout isn't a TTY (e.g. `netscli
//! scan host | grep`) or when `NO_COLOR` is set (https://no-color.org/).

use netscli_core::discover::Host;
use netscli_core::inspect::InspectResult;
use netscli_core::scan::PortResult;
use netscli_core::sweep::SweepEntry;
use std::sync::OnceLock;
use std::time::Instant;

// ANSI SGR codes.
const RESET: &str = "\x1b[0m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const RED: &str = "\x1b[31m";
const DIM: &str = "\x1b[2m";
const WHITE: &str = "\x1b[37m";

/// Decide once per process whether we should emit ANSI color. Respects the
/// `NO_COLOR` convention and falls back to "no color" when stdout is piped.
fn color_enabled() -> bool {
    static DECISION: OnceLock<bool> = OnceLock::new();
    *DECISION.get_or_init(|| {
        if std::env::var_os("NO_COLOR").is_some() {
            return false;
        }
        // We only have access to `std::io::IsTerminal` without extra deps.
        use std::io::IsTerminal;
        std::io::stdout().is_terminal()
    })
}

/// Wrap `text` in `color` and a trailing RESET, or return the text untouched
/// when color is disabled. This is the single source of truth — using it
/// makes the "RESET before text" bug that plagued the original impossible.
fn paint(color: &str, text: &str) -> String {
    if color_enabled() {
        format!("{color}{text}{RESET}")
    } else {
        text.to_string()
    }
}

fn dim(text: &str) -> String {
    paint(DIM, text)
}
fn cyan(text: &str) -> String {
    paint(CYAN, text)
}
fn green(text: &str) -> String {
    paint(GREEN, text)
}
fn yellow(text: &str) -> String {
    paint(YELLOW, text)
}
fn red(text: &str) -> String {
    paint(RED, text)
}
fn white(text: &str) -> String {
    paint(WHITE, text)
}

fn duration_tag(start: Instant) -> Option<String> {
    let ms = start.elapsed().as_millis();
    if ms == 0 {
        None
    } else {
        Some(dim(&format!("[{ms} ms]")))
    }
}

fn source_tag(addr: Option<&str>) -> Option<String> {
    addr.map(|a| dim(&format!("- source {a}")))
}

fn column_width(values: impl Iterator<Item = usize>, min: usize, max: usize) -> usize {
    let widest = values.max().unwrap_or(min);
    widest.clamp(min, max)
}

pub struct CliFormatter;

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
            let hostname = host.hostname.as_deref().unwrap_or("-");

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

    pub fn format_scan_result(
        results: &[PortResult],
        host: &str,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        let open_ports: Vec<_> = results.iter().filter(|p| p.open).collect();

        if open_ports.is_empty() {
            let mut parts = vec![format!(
                "{} on {}",
                yellow("No open ports found"),
                cyan(host)
            )];
            if let Some(tag) = duration_tag(start_time) {
                parts.push(tag);
            }
            return parts.join(" ");
        }

        let mut header_parts = vec![format!("{} on {}", green("Open ports"), cyan(host))];
        if let Some(tag) = duration_tag(start_time) {
            header_parts.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            header_parts.push(src);
        }

        format!(
            "{}\n\n{}",
            header_parts.join(" "),
            Self::format_scan_table(&open_ports)
        )
    }

    fn format_scan_table(ports: &[&PortResult]) -> String {
        let header = dim(&format!("{:<8} {:<10} {}", "Port", "State", "Service"));
        let separator = dim(&"-".repeat(30));

        let mut rows = vec![header, separator];
        for port in ports {
            let service = port.service.as_deref().unwrap_or("unknown");
            rows.push(format!(
                "{:<8} {:<10} {}",
                port.port,
                green("OPEN"),
                dim(service)
            ));
        }
        rows.join("\n")
    }

    pub fn format_inspect_result(
        result: &InspectResult,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        let mut lines: Vec<String> = Vec::new();
        lines.push(cyan(&format!("Inspection Results for {}", result.host)));

        if let Some(ip) = result.ip {
            lines.push(format!("{} {}", dim("IP:"), white(&ip.to_string())));
        }
        if let Some(hostname) = &result.hostname {
            lines.push(format!("{} {}", dim("Hostname:"), white(hostname)));
        }
        if let Some(ping) = &result.ping {
            let status = if ping.alive {
                green("Alive")
            } else {
                red("Dead")
            };
            let mut ping_info = vec![status];
            if let Some(rtt) = ping.rtt_ms {
                ping_info.push(dim(&format!("{rtt}ms")));
            }
            lines.push(format!("{} {}", dim("Ping:"), ping_info.join(" ")));
        }

        if !result.open_ports.is_empty() {
            lines.push(String::new());
            lines.push(green("Open Ports:"));
            for port in &result.open_ports {
                let service = port.service.as_deref().unwrap_or("unknown");
                lines.push(format!(
                    "  {} ({})",
                    white(&port.port.to_string()),
                    dim(service)
                ));
            }
        }

        if let Some(tag) = duration_tag(start_time) {
            lines.push(String::new());
            lines.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            lines.push(src);
        }

        lines.join("\n")
    }

    pub fn format_sweep_result(
        entries: &[SweepEntry],
        subnet: &str,
        start_time: Instant,
        local_address: Option<&str>,
    ) -> String {
        let with_open: Vec<_> = entries
            .iter()
            .filter(|e| !e.open_ports.is_empty())
            .collect();

        let mut header_parts = vec![format!(
            "{} in subnet {} ({} hosts with open ports)",
            green(&format!("Swept {} hosts", entries.len())),
            cyan(subnet),
            with_open.len()
        )];
        if let Some(tag) = duration_tag(start_time) {
            header_parts.push(tag);
        }
        if let Some(src) = source_tag(local_address) {
            header_parts.push(src);
        }

        let mut out = header_parts.join(" ");
        if with_open.is_empty() {
            out.push_str("\n\n");
            out.push_str(&dim("No hosts with open ports."));
            return out;
        }

        out.push('\n');
        for entry in with_open {
            out.push('\n');
            out.push_str(&format!(
                "{} {}",
                dim("host"),
                cyan(&entry.host.ip.to_string()),
            ));
            if let Some(name) = &entry.host.hostname {
                out.push_str(&format!(" {}", dim(&format!("({name})"))));
            }
            out.push('\n');
            for port in &entry.open_ports {
                let service = port.service.as_deref().unwrap_or("unknown");
                out.push_str(&format!("  {:>5} {}\n", port.port, dim(service),));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paint_respects_disabled_color() {
        // `paint` uses a OnceLock so we can't toggle it from tests, but we
        // can still verify the strings we emit compile and don't contain
        // accidental "RESET before text" sequences like `\x1b[36m\x1b[0m`.
        let out = cyan("hello");
        assert!(!out.contains("\x1b[36m\x1b[0m"));
    }

    #[test]
    fn format_discover_result_is_never_empty() {
        let out = CliFormatter::format_discover_result(&[], "10.0.0.0/24", Instant::now(), None);
        assert!(out.contains("Discovered 0 hosts"));
        assert!(out.contains("No hosts found"));
    }

    #[test]
    fn format_scan_result_no_ports() {
        let out = CliFormatter::format_scan_result(&[], "host.example", Instant::now(), None);
        assert!(out.contains("No open ports"));
    }

    #[test]
    fn format_scan_result_with_open_port() {
        let results = vec![PortResult {
            port: 22,
            open: true,
            service: Some("ssh".to_string()),
            error: None,
        }];
        let out = CliFormatter::format_scan_result(&results, "host.example", Instant::now(), None);
        assert!(out.contains("Open ports"));
        assert!(out.contains("22"));
        assert!(out.contains("ssh"));
    }

    #[test]
    fn format_sweep_result_empty() {
        let out = CliFormatter::format_sweep_result(&[], "10.0.0.0/24", Instant::now(), None);
        assert!(out.contains("Swept 0 hosts"));
        assert!(out.contains("No hosts with open ports"));
    }
}
