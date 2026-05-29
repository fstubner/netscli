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

    pub fn get_arp_table(&self) -> Result<Vec<ArpEntry>> {
        NetworkManager::get_arp_table()
    }
}
