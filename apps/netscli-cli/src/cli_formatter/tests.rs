use netscli_core::scan::{PortResult, PortStatus};
use std::time::Instant;

use super::style::cyan;
use super::CliFormatter;

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
    assert!(out.contains("No ports scanned"));
    assert!(out.contains("host.example"));
}

#[test]
fn format_scan_result_with_open_port() {
    let results = vec![PortResult {
        port: 22,
        open: true,
        status: PortStatus::Open,
        service: Some("ssh".to_string()),
        latency_ms: Some(1),
        banner: None,
        http: None,
        tls: None,
        raw: None,
        error: None,
    }];
    let out = CliFormatter::format_scan_result(&results, "host.example", Instant::now(), None);
    assert!(out.contains("Scanned 1 port"));
    assert!(out.contains("OPEN"));
    assert!(out.contains("1ms"));
    assert!(out.contains("22"));
    assert!(out.contains("ssh"));
}

#[test]
fn format_scan_result_with_mixed_statuses_keeps_all_rows() {
    let results = vec![
        port_result(22, PortStatus::Open, true, Some(2), None),
        port_result(80, PortStatus::Closed, false, Some(1), None),
        port_result(443, PortStatus::Filtered, false, None, None),
        port_result(8080, PortStatus::Error, false, None, Some("probe failed")),
    ];
    let out = CliFormatter::format_scan_result(&results, "host.example", Instant::now(), None);

    assert!(out.contains("Scanned 4 ports"));
    assert!(out.contains("OPEN"));
    assert!(out.contains("CLOSED"));
    assert!(out.contains("FILTERED"));
    assert!(out.contains("ERROR"));
    assert!(out.contains("timeout"));
    assert!(out.contains("probe failed"));
}

#[test]
fn format_sweep_result_empty() {
    let out = CliFormatter::format_sweep_result(&[], "10.0.0.0/24", Instant::now(), None);
    assert!(out.contains("Swept 0 hosts"));
    assert!(out.contains("No hosts with open ports"));
}

fn port_result(
    port: u16,
    status: PortStatus,
    open: bool,
    latency_ms: Option<u64>,
    error: Option<&str>,
) -> PortResult {
    PortResult {
        port,
        open,
        status,
        service: None,
        latency_ms,
        banner: None,
        http: None,
        tls: None,
        raw: None,
        error: error.map(str::to_string),
    }
}
