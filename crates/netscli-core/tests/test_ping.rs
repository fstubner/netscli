//! Gate 2 baseline: ping contract.
//!
//! Phase 2 of IMPLEMENTATION_PLAN.md replaces the probe mechanism entirely --
//! `IcmpSendEcho2` on Windows, unprivileged ICMP datagram sockets on Unix --
//! while promising `PingResult`, `PingScanner` and their signatures survive.
//! These pin that promise.
//!
//! What they deliberately do *not* assert is that a ping succeeds. Whether
//! ICMP is permitted depends on privileges and, on Linux, on
//! `net.ipv4.ping_group_range`; whether the TCP fallback finds anything
//! depends on what is listening. A gate that fails because a CI runner
//! forbids raw sockets is a gate people learn to ignore. So these assert the
//! shape of the answer and that one always arrives.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Instant;

use netscli_core::PingScanner;

#[tokio::test]
async fn a_ping_always_answers_with_a_well_formed_result() {
    let scanner = PingScanner::new(1);
    let target = IpAddr::V4(Ipv4Addr::LOCALHOST);

    let result = scanner.ping(target, 1_000).await;

    assert_eq!(
        result.ip, target,
        "the result must name the target it probed"
    );
    assert!(
        result.method.is_some(),
        "every result must say which mechanism produced it: {result:?}"
    );
    // `seq` is drawn from a process-global counter, so its absolute value
    // depends on what else in this binary has pinged. Only allocation is
    // assertable -- see the note in config_safety.rs.
    assert!(result.seq >= 1);
    if result.alive {
        assert!(result.rtt_ms.is_some(), "a live host must carry an RTT");
    }
}

#[tokio::test]
async fn an_ipv6_target_is_handled_rather_than_panicking() {
    // The current backend falls back to TCP for IPv6. Phase 2 adds native
    // ICMPv6; either way this must return, not panic or hang.
    let scanner = PingScanner::new(1);
    let target = IpAddr::V6(Ipv6Addr::LOCALHOST);

    let result = scanner.ping(target, 1_000).await;

    assert_eq!(result.ip, target);
    assert!(result.method.is_some());
}

#[tokio::test]
async fn the_timeout_is_honoured_for_an_unroutable_target() {
    // TEST-NET-1 (RFC 5737): reserved for documentation, never routed, so
    // this exercises the timeout path without sending anything anywhere real.
    let scanner = PingScanner::new(1);
    let target = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));

    let started = Instant::now();
    let result = scanner.ping(target, 500).await;
    let elapsed = started.elapsed();

    assert_eq!(result.ip, target);
    // Generous: the TCP fallback tries several ports in sequence, and CI
    // runners are slow. This catches a probe that ignores its deadline
    // entirely, which is the regression that matters.
    assert!(
        elapsed.as_secs() < 20,
        "ping ignored its timeout: took {elapsed:?}"
    );
}

#[tokio::test]
async fn concurrency_zero_does_not_deadlock() {
    // A zero-capacity semaphore would hang forever rather than fail.
    let scanner = PingScanner::new(0);
    let result = scanner.ping(IpAddr::V4(Ipv4Addr::LOCALHOST), 500).await;
    assert_eq!(result.ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
}

#[tokio::test]
async fn results_serialize_with_the_fields_downstream_reads() {
    let scanner = PingScanner::new(1);
    let result = scanner.ping(IpAddr::V4(Ipv4Addr::LOCALHOST), 1_000).await;

    let value = serde_json::to_value(&result).expect("PingResult serializes");
    for key in ["ip", "alive", "seq"] {
        assert!(value.get(key).is_some(), "missing {key}: {value}");
    }
}
