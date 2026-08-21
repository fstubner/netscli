//! Gate 4 baseline: TCP scanning contract.
//!
//! These pin what Phase 4 of IMPLEMENTATION_PLAN.md must not break while it
//! adds `SO_LINGER=0` and adaptive pacing. They deliberately test the
//! *current* contract rather than the unbuilt feature: a gate is only useful
//! if it can run before the phase starts and still passes after it lands.
//!
//! Everything here is hermetic. The scanner is pointed at a listener this
//! test binds itself, so there is no dependence on what happens to be
//! running on the machine, and no packet leaves loopback.

use std::net::{IpAddr, Ipv4Addr};

use netscli_core::{PortScanner, PortStatus};
use tokio::net::TcpListener;

const LOCALHOST: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

/// Bind a listener and return the port it landed on.
async fn open_port() -> (TcpListener, u16) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind a loopback listener");
    let port = listener.local_addr().expect("listener address").port();
    (listener, port)
}

/// A port nothing is listening on: bind one, read its number, drop it.
async fn closed_port() -> u16 {
    let (listener, port) = open_port().await;
    drop(listener);
    port
}

#[tokio::test]
async fn an_open_port_is_reported_open() {
    let (_listener, port) = open_port().await;
    let scanner = PortScanner::new(8);

    let results = scanner
        .scan_host(LOCALHOST, vec![port], 2_000)
        .await
        .expect("scanning a bound loopback port must succeed");

    assert_eq!(results.len(), 1);
    let result = &results[0];
    assert_eq!(result.port, port);
    assert!(result.open, "a bound port must read as open: {result:?}");
    assert_eq!(result.status, PortStatus::Open);
}

#[tokio::test]
async fn a_closed_port_is_reported_but_not_open() {
    let port = closed_port().await;
    let scanner = PortScanner::new(8);

    let results = scanner
        .scan_host(LOCALHOST, vec![port], 2_000)
        .await
        .expect("scanning an unbound loopback port must still succeed");

    // The result must be *present* and not open. This is the distinction
    // `scan --json` used to erase by filtering to open ports only: a closed
    // port and a port that was never scanned looked identical downstream.
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].port, port);
    assert!(!results[0].open);
    assert_ne!(results[0].status, PortStatus::Open);
}

#[tokio::test]
async fn every_requested_port_comes_back() {
    // Phase 4's pacing must not silently drop probes under concurrency.
    let (_listener, open) = open_port().await;
    let mut requested = vec![open];
    for _ in 0..15 {
        requested.push(closed_port().await);
    }

    let scanner = PortScanner::new(16);
    let results = scanner
        .scan_host(LOCALHOST, requested.clone(), 2_000)
        .await
        .expect("mixed open/closed scan must succeed");

    assert_eq!(
        results.len(),
        requested.len(),
        "every requested port must produce a result"
    );
    let mut got: Vec<u16> = results.iter().map(|r| r.port).collect();
    let mut want = requested;
    got.sort_unstable();
    want.sort_unstable();
    assert_eq!(got, want);
}

#[tokio::test]
async fn the_scanner_validates_its_own_port_list() {
    // Public API on a published crate: a consumer building a Vec<u16> by
    // hand must not be able to bypass the caps that `Ops` applies.
    let scanner = PortScanner::new(4);

    assert!(
        scanner.scan_host(LOCALHOST, vec![0], 500).await.is_err(),
        "port 0 must be refused by the scanner itself"
    );

    let too_many: Vec<u16> = (1..=(netscli_core::MAX_PORTS_PER_SCAN as u16 + 1)).collect();
    assert!(
        scanner.scan_host(LOCALHOST, too_many, 500).await.is_err(),
        "a list over MAX_PORTS_PER_SCAN must be refused"
    );
}

#[tokio::test]
async fn results_serialize_with_the_fields_downstream_reads() {
    // The GUI, the MCP layer and `--json` all read these names. Phase 4 is
    // free to change how a probe is performed; renaming what it reports is
    // a breaking change to three surfaces at once.
    let (_listener, port) = open_port().await;
    let scanner = PortScanner::new(4);
    let results = scanner
        .scan_host(LOCALHOST, vec![port], 2_000)
        .await
        .unwrap();

    let value = serde_json::to_value(&results[0]).expect("PortResult serializes");
    assert!(value.get("port").is_some(), "port field: {value}");
    assert!(value.get("open").is_some(), "open field: {value}");
    assert!(value.get("status").is_some(), "status field: {value}");
}
