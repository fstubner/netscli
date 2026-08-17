use super::config::Ops;
use crate::error::Result;
use crate::{ArpEntry, InterfaceInfo, NetworkManager};

impl Ops {
    pub fn list_interfaces(&self) -> Vec<InterfaceInfo> {
        NetworkManager::get_interfaces()
    }

    /// Discover services via mDNS/DNS-SD across a curated list of common
    /// service types. Waits up to `timeout` for responses.
    ///
    /// Pass an empty `service_types` slice to use
    /// [`crate::mdns::COMMON_SERVICE_TYPES`] as the default probe set.
    #[cfg(feature = "mdns")]
    pub async fn discover_mdns(
        &self,
        service_types: &[String],
        timeout: std::time::Duration,
    ) -> Result<Vec<crate::mdns::MdnsService>> {
        if service_types.is_empty() {
            crate::mdns::MdnsEngine::discover_common(timeout).await
        } else {
            let refs: Vec<&str> = service_types.iter().map(String::as_str).collect();
            crate::mdns::MdnsEngine::discover(&refs, timeout).await
        }
    }

    /// Read the local ARP/neighbour table.
    ///
    /// Async, and it moves the read to a blocking thread, because on Windows
    /// and macOS this shells out to `arp` and waits on the child process.
    /// Every other method on `Ops` is async, so a sync one here invited
    /// exactly the bug it produced: three separate callers — the MCP tool
    /// dispatcher, the Tauri command, and `DiscoverEngine` — all invoked it
    /// straight from an async context and parked a runtime worker on
    /// `waitpid` for the life of the subprocess.
    ///
    /// The MCP case was the sharp one. Its handlers are capped at 16
    /// concurrent, and the read loop is itself a task on the same pool, so
    /// sixteen `get_arp_table` calls could stall every worker — including
    /// the one reading stdin. No further request would even be parsed, and
    /// a cancellation could not get through.
    pub async fn get_arp_table(&self) -> Result<Vec<ArpEntry>> {
        tokio::task::spawn_blocking(NetworkManager::get_arp_table)
            .await
            .map_err(|e| crate::error::Error::Other(format!("ARP read task failed: {e}")))?
    }
}
