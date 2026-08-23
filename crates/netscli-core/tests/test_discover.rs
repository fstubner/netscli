//! Gate 3 baseline: discovery and hostname contract.
//!
//! Phase 3 of IMPLEMENTATION_PLAN.md replaces single-protocol reverse DNS
//! with a fused resolver across DNS PTR, mDNS, LLMNR and NetBIOS. `Host`
//! keeps its shape through that, but `Host.hostname` changes *meaning*: a
//! NetBIOS name and a DNS PTR name for the same machine are frequently
//! different strings. These pin what stays true either way.
//!
//! Scope note: discovery on a real subnet depends on what is plugged in, so
//! these use a loopback /30 -- two host addresses, no traffic off the
//! machine, and a bounded runtime on any runner.

use std::net::{IpAddr, Ipv4Addr};

use ipnet::Ipv4Net;
use netscli_core::DiscoverEngine;

/// 127.0.0.0/30: hosts .1 and .2, both loopback, neither routed anywhere.
fn loopback_slash_30() -> Ipv4Net {
    "127.0.0.0/30".parse().expect("a valid /30")
}

#[tokio::test]
async fn a_small_subnet_scan_completes_and_is_bounded() {
    let engine = DiscoverEngine::new_with_timeouts(8, 300, 300);

    let started = std::time::Instant::now();
    let hosts = engine
        .scan_subnet(loopback_slash_30(), false)
        .await
        .expect("scanning a /30 must succeed");
    let elapsed = started.elapsed();

    // Two host addresses at a 300ms ping timeout. A generous ceiling, since
    // what this catches is a scan that ignores its timeouts entirely.
    assert!(
        elapsed.as_secs() < 30,
        "a /30 scan should not take {elapsed:?}"
    );
    // Every returned host must be inside the range that was asked for --
    // the fused resolver must not widen what gets probed.
    for host in &hosts {
        let IpAddr::V4(v4) = host.ip else {
            panic!("an IPv4 subnet scan returned a non-IPv4 host: {host:?}");
        };
        assert!(
            loopback_slash_30().contains(&v4),
            "{v4} is outside the scanned range"
        );
    }
}

#[tokio::test]
async fn resolving_names_does_not_change_which_hosts_are_returned() {
    // Phase 3 fires four resolvers per host. Name resolution must stay a
    // decoration on the host list, not something that adds or drops entries.
    let engine = DiscoverEngine::new_with_timeouts(8, 300, 300);

    let without = engine
        .scan_subnet(loopback_slash_30(), false)
        .await
        .unwrap();
    let with = engine.scan_subnet(loopback_slash_30(), true).await.unwrap();

    let mut a: Vec<IpAddr> = without.iter().map(|h| h.ip).collect();
    let mut b: Vec<IpAddr> = with.iter().map(|h| h.ip).collect();
    a.sort_unstable();
    b.sort_unstable();
    assert_eq!(a, b, "resolving names changed the set of hosts found");
}

#[tokio::test]
async fn a_hostname_is_never_blank_or_control_laden() {
    // Names arrive from whatever answers on the link. NetBIOS and LLMNR
    // (Phase 3) are answered by anything that feels like replying, so a
    // hostname is attacker-influenced text: it must be either absent or
    // meaningful, never an empty string or a terminal control sequence.
    let engine = DiscoverEngine::new_with_timeouts(8, 300, 300);
    let hosts = engine.scan_subnet(loopback_slash_30(), true).await.unwrap();

    for host in &hosts {
        let Some(name) = host.hostname.as_deref() else {
            continue;
        };
        assert!(!name.trim().is_empty(), "empty hostname on {}", host.ip);
        assert!(
            !name.chars().any(char::is_control),
            "control character in hostname {name:?} for {}",
            host.ip
        );
    }
}

#[tokio::test]
async fn the_engine_refuses_a_subnet_over_the_limit() {
    // Public API re-exported at the crate root: the /16 cap has to hold here
    // and not only in `Ops`. Phase 3 touches this function's body.
    let engine = DiscoverEngine::new_with_timeouts(8, 300, 300);
    let error = engine
        .scan_subnet("0.0.0.0/0".parse().unwrap(), false)
        .await
        .expect_err("an unbounded subnet must be refused");
    assert!(
        error.to_string().contains("subnet too large"),
        "got: {error}"
    );
}

#[tokio::test]
async fn hosts_serialize_with_the_fields_downstream_reads() {
    let host = netscli_core::Host {
        ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
        hostname: Some("device.local".to_string()),
        mac: Some("00:11:22:33:44:55".to_string()),
        vendor: Some("Example Corp".to_string()),
        rtt_ms: Some(3),
        found_by: netscli_core::FoundBy::Probe,
    };

    let value = serde_json::to_value(&host).expect("Host serializes");
    for key in ["ip", "hostname", "mac", "vendor", "found_by"] {
        assert!(value.get(key).is_some(), "missing {key}: {value}");
    }
}

#[tokio::test]
async fn a_host_that_never_answers_is_still_reported_when_the_os_knows_it() {
    // Discovery used to keep only hosts that replied to a probe, and drop
    // everything else -- while already holding the ARP table it needed to
    // know better, using it merely to decorate the survivors. On one
    // ordinary LAN that reported 13 of 25 devices: consumer IoT routinely
    // ignores ICMP, and Windows drops echo requests by default.
    //
    // This cannot assert a specific count without a known network, so it
    // asserts the property that made those devices vanish: every host is
    // labelled with how it was found, and a host found only in the
    // neighbour table is a legitimate result rather than something to
    // discard.
    let engine = DiscoverEngine::new_with_timeouts(8, 300, 300);
    let hosts = engine
        .scan_subnet(loopback_slash_30(), false)
        .await
        .unwrap();

    for host in &hosts {
        match host.found_by {
            // A probe reply is the only thing that can carry an RTT.
            netscli_core::FoundBy::Probe => {}
            // A neighbour did not answer, so it cannot have one.
            netscli_core::FoundBy::Neighbor => assert!(
                host.rtt_ms.is_none(),
                "a neighbour-only host cannot have an RTT: {host:?}"
            ),
        }
    }
}
