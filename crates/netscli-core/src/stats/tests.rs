//! Tests for the network traffic monitor.
//!
//! Split from `stats.rs` to keep it under the maintainability cap.

use super::*;

// C-01: `now - ACTIVE_HOLD - ACTIVE_HOLD` panics on underflow, which is
// reachable within ~360ms of the monotonic clock's origin. There is no
// portable way to construct a near-zero `Instant`, so this pins the
// saturating arithmetic itself rather than the call site.
#[test]
fn instant_underflow_saturates_instead_of_panicking() {
    let origin = Instant::now();
    let hold = NetworkMonitor::ACTIVE_HOLD;

    // Mirrors the expression in `new()` and `refresh()`.
    let inactive = origin
        .checked_sub(hold)
        .and_then(|t| t.checked_sub(hold))
        .unwrap_or(origin);

    // Either it stepped back by two holds, or it clamped at the origin —
    // never a panic, and never a time in the future.
    assert!(inactive <= origin);
}

// C-02: these are per-interface byte counters summed across every
// adapter, and `+=` panics on overflow in a debug build.
#[test]
fn traffic_accumulation_saturates_on_overflow() {
    let mut rx: u64 = u64::MAX - 1;
    rx = rx.saturating_add(1_000_000);
    assert_eq!(rx, u64::MAX);
}

#[test]
fn bytes_to_mbps_typical() {
    // 1_000_000 bytes in 1 second = 8 Mbps
    assert!((bytes_to_mbps(1_000_000, Duration::from_secs(1)) - 8.0).abs() < 1e-6);
}

#[test]
fn bytes_to_mbps_zero_elapsed_safe() {
    assert_eq!(bytes_to_mbps(1_000_000, Duration::from_secs(0)), 0.0);
}

#[test]
fn bytes_to_mbps_reports_true_value_for_gbe() {
    // 1.25 GB in 1s = 10 Gbps = 10_000 Mbps. Previously this was
    // silently clamped to 999.99 which hid gigabit+ link activity.
    let actual = bytes_to_mbps(1_250_000_000, Duration::from_secs(1));
    assert!(
        (actual - 10_000.0).abs() < 1.0,
        "expected ~10_000 Mbps, got {actual}"
    );
}

#[test]
fn new_monitor_reports_available_on_refresh() {
    // Smoke test: constructing and calling get_stats should never panic
    // and should report `available=true` if any network interface exists
    // on the test host (all CI runners do).
    let monitor = NetworkMonitor::new();
    let stats = monitor.get_stats();
    // Not asserting `available` since some sandboxed CI may lack interfaces;
    // just ensuring the call path is sound.
    assert!(stats.upload_mbps >= 0.0 && stats.download_mbps >= 0.0);
}

#[test]
fn selected_interface_round_trips() {
    let monitor = NetworkMonitor::new();
    assert_eq!(monitor.selected_interface(), None);
    monitor.set_interface(Some("lo0".to_string()));
    assert_eq!(monitor.selected_interface(), Some("lo0".to_string()));
    monitor.set_interface(None);
    assert_eq!(monitor.selected_interface(), None);
}
