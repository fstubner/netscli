use super::common::{fit_cell, tree_child_line};
use super::Formatter;
use ipnet::IpNet;
use netscli_core::{ArpEntry, InterfaceInfo};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
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
}
