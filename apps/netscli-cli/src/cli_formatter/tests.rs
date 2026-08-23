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

// --- Terminal-escape safety -----------------------------------------------
//
// Hostnames are chosen by whatever answered the reverse lookup. On Windows
// that resolution goes through LLMNR/NetBIOS via `ping -a`, where any device
// on the local link picks its own name and nothing escapes it.
//
// These pin the plain-text CLI path specifically: the TUI is safe because
// ratatui filters control graphemes, and --json/--yaml are safe because
// serde escapes them. This path writes bytes straight to the terminal.
//
// They assert on the hostile sequence rather than on ESC generally, because
// the colour helpers legitimately emit ESC when colour is enabled.

/// `ESC [ 1 A` moves the cursor up a line. Combined with `ESC [ 2 K`
/// (erase line) it lets a scanned device overwrite the row printed above
/// its own — forging another host's entry in the operator's output.
const CURSOR_UP: &str = "\u{1b}[1A";

fn hostile_host() -> netscli_core::discover::Host {
    netscli_core::discover::Host {
        ip: "10.0.0.7".parse().unwrap(),
        hostname: Some(format!("evil{CURSOR_UP}\u{1b}[2K")),
        mac: Some("aa:bb:cc:dd:ee:ff".to_string()),
        vendor: None,
        rtt_ms: Some(1),
        found_by: netscli_core::FoundBy::Probe,
    }
}

#[test]
fn discover_table_neutralises_a_hostile_hostname() {
    let out = CliFormatter::format_discover_result(
        &[hostile_host()],
        "10.0.0.0/24",
        Instant::now(),
        None,
    );
    assert!(
        !out.contains(CURSOR_UP),
        "cursor-up survived into discover output: {out:?}"
    );
    // Still shown, just defused — dropping the row would hide the device.
    assert!(out.contains("evil"), "hostname vanished entirely: {out:?}");
}

#[test]
fn sweep_output_neutralises_a_hostile_hostname() {
    let entry = netscli_core::sweep::SweepEntry {
        host: hostile_host(),
        open_ports: vec![port_result(22, PortStatus::Open, true, Some(1), None)],
    };
    let out = CliFormatter::format_sweep_result(&[entry], "10.0.0.0/24", Instant::now(), None);
    assert!(
        !out.contains(CURSOR_UP),
        "cursor-up survived into sweep output: {out:?}"
    );
}
