use super::*;

#[test]
fn closed_and_filtered_ports_are_dropped_and_the_rest_kept() {
    use netscli_core::PortStatus;
    assert!(worth_reporting(PortStatus::Open));
    assert!(worth_reporting(PortStatus::OpenFiltered));
    assert!(worth_reporting(PortStatus::Error));
    assert!(!worth_reporting(PortStatus::Closed));
    assert!(!worth_reporting(PortStatus::Filtered));
}

#[test]
fn without_a_timeout_each_phase_keeps_the_core_default() {
    let cfg = ops_config(64, None);
    assert_eq!(cfg.concurrency, 64);
    assert_eq!(cfg.ping_timeout_ms, netscli_core::DEFAULT_PING_TIMEOUT_MS);
    assert_eq!(cfg.scan_timeout_ms, netscli_core::DEFAULT_SCAN_TIMEOUT_MS);
    assert_eq!(cfg.dns_timeout_ms, netscli_core::DEFAULT_DNS_TIMEOUT_MS);
}

#[test]
fn a_timeout_from_the_client_applies_to_every_phase_within_bounds() {
    let cfg = ops_config(64, Some(2_000));
    assert_eq!(
        (cfg.ping_timeout_ms, cfg.scan_timeout_ms, cfg.dns_timeout_ms),
        (2_000, 2_000, 2_000)
    );
    assert_eq!(ops_config(64, Some(1)).scan_timeout_ms, 10);
}

#[test]
fn a_publicly_addressed_interface_is_refused_rather_than_scanned() {
    // The case this whole change exists for. Before, the default was
    // substituted inside `Ops` after every check had run, so a host whose
    // LAN is publicly addressed -- some universities and ISPs still do
    // this -- had its own subnet scanned with no policy consulted.
    let err = resolve_and_check(None, || "203.0.113.0/24".to_string())
        .expect_err("a public default must be refused, not silently scanned");
    let message = err.to_string();
    assert!(message.contains("203.0.113.0/24"), "got: {message}");
    assert!(
        message.contains("NETSCLI_MCP_ALLOW_PUBLIC_TARGETS"),
        "got: {message}"
    );
}

#[test]
fn an_ordinary_private_default_is_returned_unchanged() {
    let subnet = resolve_and_check(None, || "192.168.1.0/24".to_string())
        .expect("a private default must pass");
    assert_eq!(subnet, "192.168.1.0/24");
}

#[test]
fn an_explicit_subnet_wins_over_the_default() {
    // The default must not be consulted at all when one was supplied,
    // or a bad default could override a good request.
    let subnet = resolve_and_check(Some("10.1.2.0/24".to_string()), || {
        panic!("the default must not be evaluated when a subnet was given")
    })
    .expect("an explicit private subnet must pass");
    assert_eq!(subnet, "10.1.2.0/24");
}
