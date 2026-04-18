//! Multicast DNS / DNS-SD service discovery.
//!
//! Browses the local link for services advertised via mDNS (Bonjour,
//! Avahi, Windows DNS-SD) and returns resolved devices with their
//! hostnames, addresses, and service metadata. Much friendlier than a
//! bare IP scan for "what's on my network" questions: an agent that
//! asks "is the kitchen Chromecast online?" can match by hostname and
//! service type rather than guessing IPs.
//!
//! Pure-Rust implementation on top of `mdns-sd`. No libpcap, no OS
//! Bonjour runtime dependency.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use tokio::task::JoinSet;

use crate::error::{Error, Result};

/// A service discovered via mDNS/DNS-SD.
///
/// One physical device typically announces several services (e.g. a
/// printer exposing both `_ipp._tcp.` and `_http._tcp.`). Each
/// announcement becomes a separate `MdnsService` — callers that want a
/// per-host view should group by [`MdnsService::hostname`].
#[derive(Debug, Clone, Serialize)]
pub struct MdnsService {
    /// Full service instance name, e.g. `MyPrinter._ipp._tcp.local.`
    pub full_name: String,
    /// Host that owns this service, e.g. `MyPrinter.local.`
    pub hostname: String,
    /// Service type (with trailing dot), e.g. `_ipp._tcp.local.`
    pub service_type: String,
    /// IPv4 and IPv6 addresses the daemon resolved for the host.
    pub addresses: Vec<IpAddr>,
    /// Port the service listens on.
    pub port: u16,
    /// Free-form TXT record properties (`key=value` pairs from the
    /// DNS TXT record, decoded to strings where possible).
    pub properties: HashMap<String, String>,
}

/// Curated list of service types that cover most of what's announced on a
/// typical home or office LAN. Agents and CLIs should use this as a
/// reasonable default; callers who want a specific probe can pass their
/// own list to [`MdnsEngine::discover`].
pub const COMMON_SERVICE_TYPES: &[&str] = &[
    "_http._tcp.local.",
    "_https._tcp.local.",
    "_ssh._tcp.local.",
    "_sftp-ssh._tcp.local.",
    "_ipp._tcp.local.",
    "_ipps._tcp.local.",
    "_printer._tcp.local.",
    "_airplay._tcp.local.",
    "_raop._tcp.local.",
    "_googlecast._tcp.local.",
    "_spotify-connect._tcp.local.",
    "_homekit._tcp.local.",
    "_hap._tcp.local.",
    "_smb._tcp.local.",
    "_afpovertcp._tcp.local.",
    "_nfs._tcp.local.",
    "_workstation._tcp.local.",
    "_device-info._tcp.local.",
];

pub struct MdnsEngine;

impl MdnsEngine {
    /// Browse every `service_type` in parallel for up to `timeout`, then
    /// return every service the daemon fully resolved during that window.
    ///
    /// This is blocking in the sense of "doesn't return until the timeout
    /// elapses" — mDNS responses trickle in asynchronously, and many
    /// devices re-announce on a multi-second cadence, so shorter timeouts
    /// can miss devices that were silent at the start of the window.
    /// 3–5 seconds is a reasonable default for interactive use.
    pub async fn discover(service_types: &[&str], timeout: Duration) -> Result<Vec<MdnsService>> {
        if service_types.is_empty() {
            return Ok(Vec::new());
        }

        let daemon = ServiceDaemon::new()
            .map_err(|e| Error::Other(format!("mDNS daemon init failed: {e}")))?;

        // Browse each service type concurrently. `daemon.browse(..)` returns
        // a flume receiver per type; we drain each one until the deadline.
        let deadline = Instant::now() + timeout;
        let mut tasks: JoinSet<Result<Vec<MdnsService>>> = JoinSet::new();

        for stype in service_types {
            let stype = (*stype).to_string();
            let receiver = daemon
                .browse(&stype)
                .map_err(|e| Error::Other(format!("mDNS browse({stype}) failed: {e}")))?;
            tasks.spawn(async move {
                let mut out = Vec::new();
                loop {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match tokio::time::timeout(remaining, receiver.recv_async()).await {
                        Ok(Ok(ServiceEvent::ServiceResolved(info))) => {
                            let props: HashMap<String, String> = info
                                .get_properties()
                                .iter()
                                .map(|p| (p.key().to_string(), p.val_str().to_string()))
                                .collect();
                            out.push(MdnsService {
                                full_name: info.get_fullname().to_string(),
                                hostname: info.get_hostname().to_string(),
                                service_type: stype.clone(),
                                addresses: info.get_addresses().iter().copied().collect(),
                                port: info.get_port(),
                                properties: props,
                            });
                        }
                        Ok(Ok(_)) => {
                            // Other events (Announced, ServiceFound, SearchStarted,
                            // ServiceRemoved, etc.) don't carry resolved addresses.
                        }
                        Ok(Err(_)) | Err(_) => break,
                    }
                }
                Ok(out)
            });
        }

        // Collect every task's results. Errors propagate; the daemon is
        // always shut down after the JoinSet drains.
        let mut services: Vec<MdnsService> = Vec::new();
        while let Some(res) = tasks.join_next().await {
            match res {
                Ok(Ok(mut v)) => services.append(&mut v),
                Ok(Err(e)) => {
                    let _ = daemon.shutdown();
                    return Err(e);
                }
                Err(join_err) => {
                    let _ = daemon.shutdown();
                    return Err(Error::Other(format!(
                        "mDNS browse task panicked: {join_err}"
                    )));
                }
            }
        }

        // Best-effort shutdown — if the daemon is already gone we don't care.
        let _ = daemon.shutdown();
        Ok(services)
    }

    /// Convenience wrapper: [`discover`](Self::discover) with
    /// [`COMMON_SERVICE_TYPES`].
    pub async fn discover_common(timeout: Duration) -> Result<Vec<MdnsService>> {
        Self::discover(COMMON_SERVICE_TYPES, timeout).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_service_types_is_non_empty_and_well_formed() {
        assert!(!COMMON_SERVICE_TYPES.is_empty());
        for ty in COMMON_SERVICE_TYPES {
            assert!(ty.starts_with('_'), "{ty} must start with '_'");
            assert!(ty.ends_with(".local."), "{ty} must end with '.local.'");
        }
    }

    #[tokio::test]
    async fn discover_with_empty_types_returns_empty_immediately() {
        let t0 = Instant::now();
        let res = MdnsEngine::discover(&[], Duration::from_secs(10)).await;
        assert!(res.is_ok());
        assert!(res.unwrap().is_empty());
        // Must return immediately without waiting for the timeout.
        assert!(t0.elapsed() < Duration::from_secs(1));
    }
}
