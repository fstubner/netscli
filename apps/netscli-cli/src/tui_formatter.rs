use ipnet::IpNet;
use netscli_core::db::HostRecord;
use netscli_core::discover::Host;
use netscli_core::dns::DnsRecord;
use netscli_core::inspect::InspectResult;
use netscli_core::scan::PortResult;
#[cfg(feature = "pcap")]
use netscli_core::PcapResult;
use netscli_core::{ArpEntry, InterfaceInfo, PingResult, PingSummary};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::net::IpAddr;

pub struct Formatter;

impl Formatter {
    pub fn format_command_prompt(command: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::DarkGray)),
            Span::styled(command.to_string(), Style::default().fg(Color::Cyan)),
        ])
    }

    pub fn format_error(message: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                "Error: ",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
            Span::raw(message.to_string()),
        ])
    }

    pub fn format_notice(message: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                "Note: ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(message.to_string()),
        ])
    }

    #[allow(dead_code)]
    pub fn format_host_record(host: &HostRecord) -> Line<'static> {
        let ip = host.ip_address.clone().unwrap_or_else(|| "N/A".to_string());
        let mac = &host.mac_address;
        let vendor = host.vendor.clone().unwrap_or_else(|| "-".to_string());
        let hostname = host.hostname.clone().unwrap_or_else(|| "-".to_string());
        let vendor_cell = fit_cell(&vendor, 20);

        Line::from(vec![
            Span::styled(format!("{:<16}", ip), Style::default().fg(Color::Green)),
            Span::raw(" "),
            Span::styled(format!("{:<18}", mac), Style::default().fg(Color::Yellow)),
            Span::raw(" "),
            Span::styled(vendor_cell, Style::default().fg(Color::Blue)),
            Span::raw(" "),
            Span::styled(hostname, Style::default().fg(Color::White)),
        ])
    }

    pub fn format_discovered_hosts(hosts: &[Host]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Discovered hosts ", Style::default().fg(Color::Green)),
            Span::styled(hosts.len().to_string(), Style::default().fg(Color::White)),
        ]));
        lines.push(Line::default());

        if hosts.is_empty() {
            lines.push(Line::from(Span::styled(
                "No hosts discovered.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for (idx, host) in hosts.iter().enumerate() {
            let vendor = host.vendor.clone().unwrap_or_else(|| "-".to_string());
            let hostname = host.hostname.clone().unwrap_or_else(|| "-".to_string());
            let mac = host.mac.clone().unwrap_or_else(|| "-".to_string());

            lines.push(Line::from(vec![
                Span::styled("host ", Style::default().fg(Color::DarkGray)),
                Span::styled(host.ip.to_string(), Style::default().fg(Color::Green)),
            ]));
            lines.push(tree_child_line("mac", &mac, false, Color::Yellow));
            lines.push(tree_child_line("vendor", &vendor, false, Color::Blue));
            lines.push(tree_child_line("name", &hostname, true, Color::Gray));

            if idx + 1 < hosts.len() {
                lines.push(Line::default());
            }
        }
        lines
    }

    pub fn format_scan_results(results: &[PortResult]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Ports", Style::default().fg(Color::Cyan)),
            Span::styled(" (scan results)", Style::default().fg(Color::DarkGray)),
        ]));

        if results.is_empty() {
            lines.push(Line::from(Span::styled(
                "No ports scanned.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for (idx, port) in results.iter().enumerate() {
            let state_color = if port.open { Color::Green } else { Color::Red };
            let state = if port.open { "open" } else { "closed" };
            let is_last = idx + 1 == results.len();
            let mut spans: Vec<Span<'static>> = vec![
                Span::styled(tree_prefix(is_last), Style::default().fg(Color::DarkGray)),
                Span::styled(port.port.to_string(), Style::default().fg(Color::White)),
                Span::styled(" ", Style::default().fg(Color::DarkGray)),
                Span::styled(state, Style::default().fg(state_color)),
            ];
            if let Some(service) = &port.service {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(
                    service.to_string(),
                    Style::default().fg(Color::Gray),
                ));
            }
            lines.push(Line::from(spans));
        }
        lines
    }

    pub fn format_scan_target_card(
        ip: IpAddr,
        hostname: Option<String>,
        mac: Option<String>,
        vendor: Option<String>,
        has_extra_child: bool,
    ) -> Vec<Line<'static>> {
        let hostname = hostname.unwrap_or_else(|| "-".to_string());
        let mac = mac.unwrap_or_else(|| "-".to_string());
        let vendor = vendor.unwrap_or_else(|| "-".to_string());

        let lines = vec![
            Line::from(vec![
                Span::styled("host ", Style::default().fg(Color::DarkGray)),
                Span::styled(ip.to_string(), Style::default().fg(Color::Green)),
            ]),
            tree_child_line("mac", &mac, false, Color::Yellow),
            tree_child_line("vendor", &vendor, false, Color::Blue),
            tree_child_line("name", &hostname, !has_extra_child, Color::Gray),
        ];
        lines
    }

    pub fn format_sweep_summary(
        subnet: &str,
        ports: &[u16],
        total_hosts: usize,
        hosts_with_open_ports: usize,
    ) -> Vec<Line<'static>> {
        let ports = ports
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(", ");

        vec![
            Line::from(vec![
                Span::styled("Swept subnet ", Style::default().fg(Color::Green)),
                Span::styled(subnet.to_string(), Style::default().fg(Color::Cyan)),
            ]),
            tree_child_line("ports", &ports, false, Color::Gray),
            tree_child_line(
                "hosts",
                &format!("{total_hosts} • open {hosts_with_open_ports}"),
                true,
                Color::Gray,
            ),
            Line::default(),
        ]
    }

    pub fn format_open_ports_inline(open_ports: &[PortResult]) -> Line<'static> {
        if open_ports.is_empty() {
            return tree_child_line("open ports", "none", true, Color::DarkGray);
        }

        let mut spans: Vec<Span<'static>> = vec![
            Span::styled(tree_prefix(true), Style::default().fg(Color::DarkGray)),
            Span::styled("open ports ", Style::default().fg(Color::DarkGray)),
        ];
        for (i, p) in open_ports.iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw(", "));
            }
            spans.push(Span::styled(
                p.port.to_string(),
                Style::default().fg(Color::White),
            ));
            if let Some(service) = &p.service {
                spans.push(Span::styled(
                    format!(" ({service})"),
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }
        Line::from(spans)
    }

    pub fn format_arp_table(entries: &[ArpEntry]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<16}", "IP Address"),
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw(" "),
            Span::styled(
                format!("{:<18}", "MAC Address"),
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw(" "),
            Span::styled(
                format!("{:<14}", "Interface"),
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw(" "),
            Span::styled("Vendor", Style::default().fg(Color::DarkGray)),
        ]));

        for e in entries {
            let vendor = e.vendor.clone().unwrap_or_else(|| "-".to_string());
            let vendor_cell = fit_cell(&vendor, 28);
            let iface_cell = fit_cell(&e.interface, 14);
            lines.push(Line::from(vec![
                Span::styled(format!("{:<16}", e.ip), Style::default().fg(Color::Green)),
                Span::raw(" "),
                Span::styled(format!("{:<18}", e.mac), Style::default().fg(Color::Yellow)),
                Span::raw(" "),
                Span::styled(iface_cell, Style::default().fg(Color::Gray)),
                Span::raw(" "),
                Span::styled(vendor_cell, Style::default().fg(Color::Blue)),
            ]));
        }
        lines
    }

    pub fn format_interfaces(ifaces: &[InterfaceInfo]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Interfaces ", Style::default().fg(Color::Cyan)),
            Span::styled(ifaces.len().to_string(), Style::default().fg(Color::White)),
        ]));
        lines.push(Line::default());

        if ifaces.is_empty() {
            lines.push(Line::from(Span::styled(
                "No interfaces detected.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for (idx, iface) in ifaces.iter().enumerate() {
            let mac = iface
                .mac
                .map(|m| m.to_string())
                .unwrap_or_else(|| "-".to_string());
            let state = if iface.is_up { "up" } else { "down" };
            let state_color = if iface.is_up {
                Color::Green
            } else {
                Color::Red
            };

            lines.push(Line::from(vec![
                Span::styled("interface ", Style::default().fg(Color::DarkGray)),
                Span::styled(iface.name.clone(), Style::default().fg(Color::Green)),
            ]));

            let mut children: Vec<(String, String, Color)> = Vec::new();
            children.push(("state".to_string(), state.to_string(), state_color));
            children.push((
                "loopback".to_string(),
                iface.is_loopback.to_string(),
                Color::Gray,
            ));
            children.push(("mac".to_string(), mac, Color::Yellow));
            for ip in &iface.ips {
                let label = match ip {
                    IpNet::V4(_) => "ipv4",
                    IpNet::V6(_) => "ipv6",
                };
                children.push((label.to_string(), ip.to_string(), Color::Gray));
            }

            let child_len = children.len();
            for (c_idx, (label, value, color)) in children.into_iter().enumerate() {
                let is_last = c_idx + 1 == child_len;
                lines.push(tree_child_line(&label, &value, is_last, color));
            }

            if idx + 1 < ifaces.len() {
                lines.push(Line::default());
            }
        }

        lines
    }

    pub fn format_dns_results(
        host: &str,
        record: Option<&str>,
        records: &[DnsRecord],
    ) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        let record_label = record.unwrap_or("ALL").to_string();
        lines.push(Line::from(vec![
            Span::styled("DNS ", Style::default().fg(Color::Cyan)),
            Span::styled(record_label.clone(), Style::default().fg(Color::Cyan)),
            Span::styled(" for ", Style::default().fg(Color::DarkGray)),
            Span::styled(host.to_string(), Style::default().fg(Color::White)),
        ]));

        if records.is_empty() {
            lines.push(Line::from(Span::styled(
                "No records found.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        if matches!(record, Some("ALL") | Some("ANY") | None) {
            let mut order: Vec<String> = Vec::new();
            let mut grouped: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for rec in records {
                if !grouped.contains_key(&rec.record_type) {
                    order.push(rec.record_type.clone());
                }
                grouped
                    .entry(rec.record_type.clone())
                    .or_default()
                    .push(rec.value.clone());
            }

            for (idx, rec_type) in order.iter().enumerate() {
                if idx > 0 {
                    lines.push(Line::default());
                }
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default().fg(Color::DarkGray)),
                    Span::styled(rec_type.to_string(), Style::default().fg(Color::Cyan)),
                ]));
                if let Some(values) = grouped.get(rec_type) {
                    for value in values {
                        lines.push(Line::from(vec![
                            Span::styled("    ", Style::default().fg(Color::DarkGray)),
                            Span::styled(value.to_string(), Style::default().fg(Color::Green)),
                        ]));
                    }
                }
            }
        } else {
            for rec in records {
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default().fg(Color::DarkGray)),
                    Span::styled(rec.value.to_string(), Style::default().fg(Color::Green)),
                ]));
            }
        }
        lines
    }

    pub fn format_ping_summary(summary: &PingSummary) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("PING ", Style::default().fg(Color::Cyan)),
            Span::styled(summary.host.clone(), Style::default().fg(Color::White)),
            Span::styled(" (", Style::default().fg(Color::DarkGray)),
            Span::styled(summary.ip.to_string(), Style::default().fg(Color::Green)),
            Span::styled(")", Style::default().fg(Color::DarkGray)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("sent=", Style::default().fg(Color::DarkGray)),
            Span::styled(summary.sent.to_string(), Style::default().fg(Color::White)),
            Span::raw(" "),
            Span::styled("received=", Style::default().fg(Color::DarkGray)),
            Span::styled(
                summary.received.to_string(),
                Style::default().fg(Color::White),
            ),
            Span::raw(" "),
            Span::styled("loss=", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{:.1}%", summary.loss_pct),
                Style::default().fg(if summary.loss_pct >= 100.0 {
                    Color::Red
                } else if summary.loss_pct > 0.0 {
                    Color::Yellow
                } else {
                    Color::Green
                }),
            ),
        ]));

        if let (Some(min), Some(max)) = (summary.rtt_ms_min, summary.rtt_ms_max) {
            if let Some(avg) = summary.rtt_ms_avg {
                lines.push(Line::from(vec![
                    Span::styled("rtt ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format!("min/avg/max = {min}/{avg:.1}/{max} ms"),
                        Style::default().fg(Color::Gray),
                    ),
                ]));
            }
        }

        lines
    }

    pub fn format_ping_attempt(seq: u32, total: u32, res: &PingResult) -> Line<'static> {
        let prefix = format!("{seq}/{total}");
        let status_style = Style::default().fg(if res.alive { Color::Green } else { Color::Red });

        let mut spans: Vec<Span<'static>> = vec![
            Span::styled("  seq ", Style::default().fg(Color::DarkGray)),
            Span::styled(prefix, Style::default().fg(Color::Gray)),
            Span::styled("  ", Style::default().fg(Color::DarkGray)),
        ];

        if res.alive {
            if let Some(rtt) = res.rtt_ms {
                spans.push(Span::styled(
                    format!("time={rtt} ms"),
                    Style::default().fg(Color::White),
                ));
            } else {
                spans.push(Span::styled("reply", Style::default().fg(Color::White)));
            }
        } else {
            spans.push(Span::styled("timeout", status_style));
            if let Some(err) = res.error.as_deref() {
                spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(
                    err.to_string(),
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }

        if let Some(method) = res.method.as_deref() {
            spans.push(Span::styled("  ", Style::default().fg(Color::DarkGray)));
            spans.push(Span::styled(
                format!("({method})"),
                Style::default().fg(Color::DarkGray),
            ));
        }

        Line::from(spans)
    }

    #[cfg(feature = "pcap")]
    pub fn format_pcap_interfaces(devs: &[String]) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("PCAP ", Style::default().fg(Color::Cyan)),
            Span::styled("Interfaces", Style::default().fg(Color::White)),
        ]));

        if devs.is_empty() {
            lines.push(Line::from(Span::styled(
                "No capture interfaces detected.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for d in devs {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::DarkGray)),
                Span::styled(d.to_string(), Style::default().fg(Color::Gray)),
            ]));
        }
        lines
    }

    #[cfg(feature = "pcap")]
    pub fn format_pcap_result(res: &PcapResult) -> Vec<Line<'static>> {
        vec![Line::from(vec![
            Span::styled("Captured ", Style::default().fg(Color::Green)),
            Span::styled(
                res.packets_captured.to_string(),
                Style::default().fg(Color::White),
            ),
            Span::styled(" packets to ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                res.file_path.display().to_string(),
                Style::default().fg(Color::Cyan),
            ),
        ])]
    }

    pub fn format_inspect_result(res: &InspectResult) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        lines.push(Line::from(vec![
            Span::styled("Host: ", Style::default().fg(Color::Cyan)),
            Span::raw(res.host.clone()),
        ]));
        if let Some(ip) = res.ip {
            lines.push(Line::from(vec![
                Span::styled("IP:   ", Style::default().fg(Color::Cyan)),
                Span::raw(ip.to_string()),
            ]));
        }

        if let Some(ping) = &res.ping {
            let status = if ping.alive { "UP" } else { "DOWN" };
            let color = if ping.alive { Color::Green } else { Color::Red };
            lines.push(Line::from(vec![
                Span::styled("Ping: ", Style::default().fg(Color::Cyan)),
                Span::styled(status, Style::default().fg(color)),
                Span::raw(format!(" (RTT: {:?})", ping.rtt_ms)),
            ]));
        }

        if !res.open_ports.is_empty() {
            lines.push(Line::from(""));
            lines.push(Span::styled("Open Ports:", Style::default().fg(Color::Yellow)).into());
            lines.extend(Self::format_scan_results(&res.open_ports));
        }

        lines
    }
}

fn tree_prefix(is_last: bool) -> &'static str {
    if is_last {
        "  └─ "
    } else {
        "  ├─ "
    }
}

fn tree_child_line(label: &str, value: &str, is_last: bool, value_color: Color) -> Line<'static> {
    Line::from(vec![
        Span::styled(tree_prefix(is_last), Style::default().fg(Color::DarkGray)),
        Span::styled(format!("{label} "), Style::default().fg(Color::DarkGray)),
        Span::styled(value.to_string(), Style::default().fg(value_color)),
    ])
}

fn fit_cell(value: &str, width: usize) -> String {
    use unicode_width::UnicodeWidthChar;

    let value = value.trim();

    // Accumulate chars until adding one more would exceed `width` (in
    // terminal cells, NOT char counts). Emoji and CJK take 2 cells each.
    let mut used = 0usize;
    let mut kept: Vec<char> = Vec::with_capacity(value.len());
    let mut truncated = false;
    for ch in value.chars() {
        let w = ch.width().unwrap_or(0);
        if used + w > width {
            truncated = true;
            break;
        }
        kept.push(ch);
        used += w;
    }

    if truncated && width > 1 {
        // Replace the last kept char with an ellipsis, keeping total width ≤ width.
        while used > width.saturating_sub(1) {
            if let Some(last) = kept.pop() {
                used -= last.width().unwrap_or(0);
            } else {
                break;
            }
        }
        kept.push('…');
        used += 1;
    }

    let mut out: String = kept.into_iter().collect();
    let len = used;
    if len < width {
        out.push_str(&" ".repeat(width - len));
    }
    out
}
