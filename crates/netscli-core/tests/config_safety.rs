use std::net::{IpAddr, Ipv4Addr};

use netscli_core::{Ops, OpsConfig, PingScanner, PortScanner};

#[test]
fn ops_new_clamps_zero_values() {
    let cfg = OpsConfig {
        concurrency: 0,
        scan_timeout_ms: 0,
        ping_timeout_ms: 0,
        dns_timeout_ms: 0,
    };

    let ops = Ops::new(cfg);
    let cfg = ops.config();

    assert_eq!(cfg.concurrency, 1);
    assert_eq!(cfg.scan_timeout_ms, 1);
    assert_eq!(cfg.ping_timeout_ms, 1);
    assert_eq!(cfg.dns_timeout_ms, 1);
}

#[test]
fn ops_new_clamps_concurrency_upper_bound() {
    let cfg = OpsConfig {
        concurrency: 9999,
        ..Default::default()
    };

    let ops = Ops::new(cfg);
    assert_eq!(ops.config().concurrency, netscli_core::MAX_CONCURRENCY);
}

// C-10: the MCP server clamped to 4096 while this clamps to 1024, so any
// value in 1025..=4096 was accepted at the API boundary and then silently
// reduced -- and a comment claimed the two bounds matched. Both now derive
// from this constant, so a change to one cannot drift from the other.
#[test]
fn max_concurrency_is_the_value_ops_actually_enforces() {
    let cfg = OpsConfig {
        concurrency: netscli_core::MAX_CONCURRENCY + 1,
        ..Default::default()
    };
    let ops = Ops::new(cfg);
    assert_eq!(ops.config().concurrency, netscli_core::MAX_CONCURRENCY);

    // And a value just inside the bound survives untouched, which is what
    // makes the constant meaningful rather than merely an upper limit.
    let cfg = OpsConfig {
        concurrency: netscli_core::MAX_CONCURRENCY,
        ..Default::default()
    };
    assert_eq!(
        Ops::new(cfg).config().concurrency,
        netscli_core::MAX_CONCURRENCY
    );
}

#[tokio::test]
async fn resolve_host_ip_with_timeout_accepts_literal_ip() {
    let ip = netscli_core::ops::resolve_host_ip_with_timeout("127.0.0.1", 1)
        .await
        .expect("literal IP must not require DNS");
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
}

#[tokio::test]
async fn port_scanner_concurrency_zero_returns_results() {
    let scanner = PortScanner::new(0);
    let res = scanner
        .scan_host(IpAddr::V4(Ipv4Addr::LOCALHOST), vec![1], 1)
        .await;
    let res = res.expect("a one-port list is valid");
    assert_eq!(res.len(), 1);
    assert_eq!(res[0].port, 1);
}

#[tokio::test]
async fn ping_scanner_concurrency_zero_returns_result() {
    let scanner = PingScanner::new(0);
    let res = scanner.ping(IpAddr::V4(Ipv4Addr::LOCALHOST), 10).await;

    assert_eq!(res.ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(res.seq, 1);
    assert!(res.method.is_some());
}

/// Port validation must not depend on which surface the call arrives on.
///
/// Regression: `netscli scan -p 0` reported "Scanned 1 port (0 open)" while
/// the MCP `scan_ports` tool rejected the identical input, because the CLI
/// path validated in `parse_ports_checked` and the MCP path validated in its
/// own `normalize_ports`. `Ops` now validates whatever it is handed, so a
/// library consumer building a `Vec<u16>` by hand cannot bypass it either.
#[tokio::test]
async fn ops_reject_port_zero_regardless_of_caller() {
    let ops = netscli_core::Ops::default();

    assert!(
        ops.scan_ports("127.0.0.1", Some(vec![0])).await.is_err(),
        "scan_ports accepted port 0"
    );
    assert!(
        ops.inspect_host("127.0.0.1".to_string(), Some(vec![0]))
            .await
            .is_err(),
        "inspect_host accepted port 0"
    );
    assert!(
        ops.sweep_ipv4(Some("127.0.0.0/30".to_string()), Some(vec![0]), false)
            .await
            .is_err(),
        "sweep_ipv4 accepted port 0"
    );
}

#[tokio::test]
async fn ops_reject_oversized_port_lists() {
    let ops = netscli_core::Ops::default();
    let too_many: Vec<u16> = (1..=(netscli_core::MAX_PORTS_PER_SCAN as u16 + 1)).collect();
    assert!(
        ops.scan_ports("127.0.0.1", Some(too_many)).await.is_err(),
        "scan_ports accepted more than MAX_PORTS_PER_SCAN"
    );
}

// --- Engine-level limit enforcement ---------------------------------------
//
// `Ops` validated, the engines did not, and the engines are re-exported at
// the crate root. A consumer building input by hand reached them directly,
// so the documented safety limits simply did not apply. Each of these fails
// against the previous code by returning results instead of an error.

#[tokio::test]
async fn port_scanner_rejects_a_list_over_the_cap() {
    let scanner = PortScanner::new(8);
    let too_many: Vec<u16> = (1..=(netscli_core::MAX_PORTS_PER_SCAN as u16 + 1)).collect();
    let err = scanner
        .scan_host(IpAddr::V4(Ipv4Addr::LOCALHOST), too_many, 1)
        .await
        .expect_err("a list over the cap must be refused, not scanned");
    assert!(err.to_string().contains("too many ports"), "got: {err}");
}

#[tokio::test]
async fn port_scanner_rejects_port_zero() {
    let scanner = PortScanner::new(8);
    let err = scanner
        .scan_host(IpAddr::V4(Ipv4Addr::LOCALHOST), vec![0], 1)
        .await
        .expect_err("port 0 must be refused here too, not only in Ops");
    assert!(err.to_string().contains("port 0"), "got: {err}");
}

#[tokio::test]
async fn discover_engine_refuses_a_subnet_over_the_limit() {
    // /0 asks for 4,294,967,294 addresses -- about 73 GB of Vec<IpAddr> --
    // allocated before a single packet is sent.
    let engine = netscli_core::DiscoverEngine::new(8);
    let err = engine
        .scan_subnet("0.0.0.0/0".parse().unwrap(), false)
        .await
        .expect_err("an unbounded subnet must be refused by the engine");
    assert!(err.to_string().contains("subnet too large"), "got: {err}");
}

#[tokio::test]
async fn engines_clamp_absurd_concurrency_instead_of_panicking() {
    // Semaphore::new asserts on permits above usize::MAX >> 3, and these
    // constructors return Self, so they had no way to report it.
    let _ = PortScanner::new(usize::MAX);
    let _ = netscli_core::DiscoverEngine::new(usize::MAX);
    let _ = netscli_core::SweepEngine::new(usize::MAX);
    let _ = netscli_core::InspectEngine::new(usize::MAX);
}

// Each case below reached a real engine before this: the limits existed in
// the crate's documentation and in one caller, but not in the code path a
// library consumer or another surface actually took.

#[tokio::test]
async fn sweep_engine_rejects_bad_ports_before_the_ping_phase() {
    // Port 0 used to survive all the way through: `sweep_with_progress` is
    // public API and trusted its caller, then swallowed the per-host scan
    // error, so this produced a full slow ping sweep and a plausible result
    // where every host simply had no open ports.
    let engine = netscli_core::SweepEngine::new(64);
    let err = engine
        .sweep("192.168.1.0/30".parse().unwrap(), vec![0], false)
        .await
        .expect_err("port 0 must be refused by the engine");
    assert!(
        err.to_string().contains("port") || err.to_string().contains("0"),
        "got: {err}"
    );
}

#[test]
fn mdns_timeout_has_a_core_side_ceiling() {
    // The TUI clamped this itself, which left `netscli mdns --timeout-ms
    // 86400000` blocking for a day on every other surface.
    assert_eq!(netscli_core::MAX_MDNS_TIMEOUT_MS, 30_000);
}

#[tokio::test]
async fn ping_count_is_clamped_rather_than_unbounded() {
    // The loop is sequential, so the count multiplies straight into
    // wall-clock time. Only the summary's `sent` reveals the clamp.
    let ops = netscli_core::Ops::new(netscli_core::OpsConfig {
        ping_timeout_ms: 1,
        dns_timeout_ms: 200,
        ..Default::default()
    });
    let summary = ops
        .ping_host_summary("127.0.0.1", netscli_core::MAX_PING_COUNT + 500)
        .await
        .expect("loopback ping summary");
    assert_eq!(summary.sent, netscli_core::MAX_PING_COUNT);
}
