//! Filling in hostnames from mDNS, for the hosts reverse DNS cannot name.
//!
//! Consumer routers do not serve PTR records for their own DHCP clients, and
//! appliances ignore LLMNR and NetBIOS, so the reverse lookup in a discover
//! comes back empty for exactly the devices someone opened the app to
//! identify -- while those devices announce their names over mDNS the whole
//! time.
//!
//! Split out of `discover.rs` rather than living there: that file is the
//! sweep's own logic and sits against the 300-line module guidance, and this
//! is a self-contained concern with one entry point in and one map out.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use tokio::task::JoinHandle;

use crate::error::Result;
use crate::mdns::MdnsService;

/// How long the browse that runs alongside a discover listens for.
///
/// Measured on an ordinary home LAN rather than picked: unique hosts reached
/// their ceiling of 7 at 1000ms and did not move at 1500, 2000 or 3000ms,
/// while 500ms was unstable across repeat runs (3 hosts, then 5) and 250ms
/// returned nothing at all, twice. 1500 sits past the plateau with margin for
/// a slower network, and well under the 3000ms the explicit `/mdns` browse
/// uses -- that one is a deliberate "go and look", this rides along.
///
/// It bounds the only case where this costs anything. The browse starts with
/// the ping sweep, so on any real subnet it has long finished by the time the
/// sweep has: a /24 measured 2317-3466ms against this 1500ms. The window is
/// visible only when the sweep finishes first, on a /30 or a near-empty
/// range, where it added about 1.4s.
const BROWSE_WINDOW_MS: u64 = 1500;

/// Start listening now, so the browse overlaps the sweep instead of following
/// it.
///
/// Spawned rather than awaited: a browse is a fixed listening window, not
/// work that finishes early, so the only way it costs nothing is to run it
/// against the clock the sweep is already spending.
pub(super) fn spawn_browse() -> JoinHandle<Result<Vec<MdnsService>>> {
    tokio::spawn(crate::mdns::MdnsEngine::discover_common(
        Duration::from_millis(BROWSE_WINDOW_MS),
    ))
}

/// Collect the browse into an address -> name map.
///
/// Every name goes through [`crate::dns::normalize_hostname`], the same
/// function the reverse lookups use, and that is not tidiness. An mDNS name
/// is a string chosen by whoever runs the other machine, exactly like a PTR
/// record or an LLMNR reply -- untrusted remote text, which ARCHITECTURE.md
/// requires be treated as data and never as control. That function rejects
/// names carrying control characters, which is what stops a device calling
/// itself an escape sequence from repainting a terminal or forging the row
/// above it.
///
/// A failed or unavailable browse yields an empty map rather than an error:
/// no mDNS means the same blank column as before, which is the behaviour this
/// improves on rather than a regression worth reporting.
pub(super) async fn collect_names(
    handle: JoinHandle<Result<Vec<MdnsService>>>,
) -> HashMap<IpAddr, String> {
    match handle.await {
        Ok(Ok(services)) => services
            .into_iter()
            .filter_map(|service| {
                crate::dns::normalize_hostname(service.hostname)
                    .map(|name| (service.addresses, name))
            })
            .flat_map(|(addresses, name)| addresses.into_iter().map(move |ip| (ip, name.clone())))
            .collect(),
        _ => HashMap::new(),
    }
}
