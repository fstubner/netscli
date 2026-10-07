use super::Formatter;
use netscli_core::inspect::InspectResult;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

impl Formatter {
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
        if let Some(name) = &res.hostname {
            lines.push(Line::from(vec![
                Span::styled("Name: ", Style::default().fg(Color::Cyan)),
                Span::raw(name.clone()),
            ]));
        }

        if let Some(ping) = &res.ping {
            let status = if ping.alive { "UP" } else { "DOWN" };
            let color = if ping.alive { Color::Green } else { Color::Red };
            // A reply carries a time. Silence has none to show.
            let rtt = ping
                .rtt_ms
                .map(|ms| format!(" ({ms} ms)"))
                .unwrap_or_default();
            lines.push(Line::from(vec![
                Span::styled("Ping: ", Style::default().fg(Color::Cyan)),
                Span::styled(status, Style::default().fg(color)),
                Span::raw(rtt),
            ]));
        }

        // The MAC is shown whenever there is one. Only some have a known
        // maker, and phones now use random addresses that have none.
        if let Some(mac) = &res.mac {
            let text = match &res.vendor {
                Some(vendor) => format!("{mac} ({vendor})"),
                None => mac.clone(),
            };
            lines.push(Line::from(vec![
                Span::styled("MAC:  ", Style::default().fg(Color::Cyan)),
                Span::raw(text),
            ]));
        }
        if let Some(hint) = &res.os_hint {
            lines.push(Line::from(vec![
                Span::styled("OS:   ", Style::default().fg(Color::Cyan)),
                Span::raw(hint.summary()),
                Span::styled(" (hint)", Style::default().fg(Color::DarkGray)),
            ]));
            for clue in &hint.evidence {
                lines.push(Line::from(Span::styled(
                    format!("      {clue}"),
                    Style::default().fg(Color::DarkGray),
                )));
            }
        }

        if !res.open_ports.is_empty() {
            lines.push(Line::from(""));
            lines.push(Span::styled("Open Ports:", Style::default().fg(Color::Yellow)).into());
            lines.extend(Self::format_scan_results(&res.open_ports));
        }

        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netscli_core::PingResult;

    fn inspected(rtt_ms: Option<u64>, alive: bool) -> InspectResult {
        let ip = "10.0.0.7".parse().unwrap();
        InspectResult {
            host: "nas.lan".to_string(),
            ip: Some(ip),
            ping: Some(PingResult {
                ip,
                rtt_ms,
                ttl: None,
                alive,
                seq: 1,
                error: None,
                method: None,
            }),
            ports: Vec::new(),
            open_ports: Vec::new(),
            hostname: Some("nas".to_string()),
            mac: Some("aa:bb:cc:dd:ee:ff".to_string()),
            vendor: None,
            os_hint: None,
        }
    }

    fn lines_of(res: &InspectResult) -> Vec<String> {
        Formatter::format_inspect_result(res)
            .iter()
            .map(|line| line.to_string())
            .collect()
    }

    #[test]
    fn the_round_trip_time_reads_as_milliseconds() {
        // It used to print `(RTT: Some(3))`, Rust's debug form of the value.
        let lines = lines_of(&inspected(Some(3), true));
        assert!(lines.contains(&"Ping: UP (3 ms)".to_string()), "{lines:?}");
    }

    #[test]
    fn a_host_that_did_not_answer_has_no_time_to_show() {
        let lines = lines_of(&inspected(None, false));
        assert!(lines.contains(&"Ping: DOWN".to_string()), "{lines:?}");
    }

    #[test]
    fn the_mac_shows_with_or_without_a_known_maker() {
        // Only a MAC with a known vendor used to show, and the random
        // addresses phones use have none.
        let lines = lines_of(&inspected(Some(3), true));
        assert!(
            lines.contains(&"MAC:  aa:bb:cc:dd:ee:ff".to_string()),
            "{lines:?}"
        );

        let mut res = inspected(Some(3), true);
        res.vendor = Some("Apple".to_string());
        let lines = lines_of(&res);
        assert!(
            lines.contains(&"MAC:  aa:bb:cc:dd:ee:ff (Apple)".to_string()),
            "{lines:?}"
        );
    }

    #[test]
    fn the_host_name_is_shown_as_in_the_cli() {
        let lines = lines_of(&inspected(Some(3), true));
        assert!(lines.contains(&"Name: nas".to_string()), "{lines:?}");
    }
}
