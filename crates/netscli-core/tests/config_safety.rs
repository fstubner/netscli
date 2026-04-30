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
    assert_eq!(ops.config().concurrency, 1024);
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
