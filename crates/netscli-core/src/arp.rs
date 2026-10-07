mod platform;
mod types;

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use mac_address::MacAddress;

use crate::error::Result;

pub use types::{ArpEntry, InterfaceInfo};

pub struct NetworkManager;

impl NetworkManager {
    pub fn find_mac(ip: &IpAddr) -> Option<ArpEntry> {
        let table = Self::get_arp_table().ok()?;
        table.into_iter().find(|e| &e.ip == ip)
    }

    pub fn get_interfaces() -> Vec<InterfaceInfo> {
        platform::get_interfaces()
    }

    pub fn get_arp_table() -> Result<Vec<ArpEntry>> {
        platform::get_arp_table()
    }

    pub fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
        platform::add_entry(ip, mac)
    }

    pub fn delete_entry(ip: IpAddr) -> Result<()> {
        platform::delete_entry(ip)
    }

    pub fn clear_table() -> Result<()> {
        platform::clear_table()
    }
}

/// Which of `candidates` answer ARP within `wait`, for discovery's
/// table-only neighbours. On Windows the neighbour table keeps devices that
/// have gone (see platform/windows_resolve.rs), so each is asked again. On
/// Linux and macOS this is not measured yet and every candidate is kept, as
/// before.
pub(crate) async fn still_present(candidates: &[Ipv4Addr], wait: Duration) -> HashSet<Ipv4Addr> {
    #[cfg(target_os = "windows")]
    {
        use futures::stream::StreamExt;

        // Lookups in flight at once. All of them used to start together, and
        // each `wait` was counted from then, so with more candidates than
        // tokio's blocking pool has threads, lookups spent their time queued
        // and real neighbours were dropped. Now `wait` starts when a lookup
        // does.
        const AT_ONCE: usize = 64;
        // By value: a closure over `&Ipv4Addr` makes the stream's future not
        // `Send` for every lifetime, which `tokio::spawn` in discovery needs.
        let checks = candidates.iter().copied().map(|ip| async move {
            // A lookup that outlives `wait` keeps its blocking thread until
            // Windows gives up on it, about 4 s; its answer is just ignored.
            let asked = tokio::task::spawn_blocking(move || platform::answers_arp(ip));
            matches!(tokio::time::timeout(wait, asked).await, Ok(Ok(true))).then_some(ip)
        });
        futures::stream::iter(checks)
            .buffer_unordered(AT_ONCE)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .flatten()
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = wait;
        candidates.iter().copied().collect()
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_neighbour_that_does_not_answer_arp_is_dropped() {
        // TEST-NET-1 (RFC 5737): never assigned, so nothing can answer.
        let gone = Ipv4Addr::new(192, 0, 2, 77);
        let present = still_present(&[gone], Duration::from_millis(300)).await;
        assert!(present.is_empty(), "kept {present:?}");
    }
}
