use super::common::fit_cell;
use super::Formatter;
use netscli_core::db::HostRecord;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
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
}
