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

/// Regression: pinging this host used to always report 100% loss on Windows.
///
/// Raw ICMP needs administrator rights on Windows, so an ordinary run fell
/// back to TCP connect probes on ports 80/443/22 -- which nothing answers on
/// a machine asked about itself, so `netscli ping 127.0.0.1` reported total
/// loss while the system `ping` answered immediately. (Elevated runs have a
/// second problem: a Windows raw socket does not see traffic to an address
/// the host owns.) It took discover and sweep down too, since both start
/// from a ping sweep: `discover 127.0.0.0/30` came back empty.
///
/// Windows-only on purpose. Everywhere else this is a claim about the
/// environment rather than about netscli: whether an unprivileged process may
/// send ICMP depends on the runner, and the surrounding tests avoid asserting
/// success for exactly that reason. On Windows the IP Helper API needs no
/// privileges, so a failure here is a real defect and not a permission.
#[cfg(windows)]
#[tokio::test]
async fn pinging_this_host_succeeds_on_windows() {
    let scanner = PingScanner::new(1);
    let target = IpAddr::V4(Ipv4Addr::LOCALHOST);

    let result = scanner.ping(target, 2_000).await;

    assert!(
        result.alive,
        "loopback must answer its own ping: {result:?}"
    );
    assert!(result.rtt_ms.is_some(), "a live host must carry an RTT");
    // Pin the mechanism too. Without this the test would also pass if ICMP
    // silently degraded to the TCP fallback and something happened to be
    // listening on port 80 -- which is the original bug wearing a disguise.
    assert_eq!(
        result.method.as_deref(),
        Some("icmpv4"),
        "loopback should be reached over ICMP, not the TCP fallback: {result:?}"
    );
}

/// The same defect reached past loopback: an address the *host itself* owns
/// is short-circuited the same way, so `ping <my own LAN IP>` also reported
/// total loss. That is why the fix is not an `is_loopback()` special case.
#[cfg(windows)]
#[tokio::test]
async fn pinging_an_address_this_host_owns_succeeds_on_windows() {
    let Some(local) = netscli_core::NetworkManager::get_interfaces()
        .into_iter()
        .filter(|iface| !iface.is_loopback && iface.is_up)
        .find_map(|iface| {
            iface.ips.into_iter().find_map(|net| match net.addr() {
                IpAddr::V4(v4) if !v4.is_link_local() && !v4.is_loopback() => Some(IpAddr::V4(v4)),
                _ => None,
            })
        })
    else {
        // No non-loopback IPv4 address: nothing to assert about.
        return;
    };

    let result = PingScanner::new(1).ping(local, 2_000).await;

    assert!(
        result.alive,
        "this host must answer a ping to its own address {local}: {result:?}"
    );
}

/// Regression: `ping ::1` reported total loss because IPv6 had no ICMP path.
///
/// It fell through to the TCP probe, which asks ports 80/443/22 and concludes
/// a host is down when nothing answers -- the same shape of failure IPv4
/// loopback had, from a different cause. Windows-gated because Unix still
/// falls back for v6; the assertion here is about netscli having an ICMPv6
/// path at all, not about the runner's permissions.
#[cfg(windows)]
#[tokio::test]
async fn pinging_ipv6_loopback_succeeds_on_windows() {
    let scanner = PingScanner::new(1);
    let target = IpAddr::V6(Ipv6Addr::LOCALHOST);

    let result = scanner.ping(target, 2_000).await;

    assert!(result.alive, "::1 must answer its own ping: {result:?}");
    assert_eq!(
        result.method.as_deref(),
        Some("icmpv6"),
        "v6 should go over ICMPv6, not the TCP fallback: {result:?}"
    );
}

/// The v6 path must still be able to say "no". A probe that reported every
/// address alive would pass the test above and be worse than no probe.
#[cfg(windows)]
#[tokio::test]
async fn an_unreachable_ipv6_target_is_reported_dead() {
    // 2001:db8::/32 is RFC 3849 documentation space: never routed.
    let target = IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1));

    let result = PingScanner::new(1).ping(target, 1_000).await;

    assert!(
        !result.alive,
        "documentation space must not answer: {result:?}"
    );
}
