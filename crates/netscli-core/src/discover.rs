use crate::arp::NetworkManager;
use crate::error::Result;
use crate::oui::lookup_vendor;
use crate::ping::PingScanner;
use futures::stream::{self, StreamExt};
use ipnet::Ipv4Net;
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

/// How a host came to be in the results.
///
/// Worth reporting rather than flattening, because the two carry different
/// confidence. A host that answered a probe is definitely there now; a host
/// known only from the neighbour table is one the OS has spoken to
/// recently, which is usually but not always still true.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FoundBy {
    /// Answered an ICMP or TCP probe during this scan.
    Probe,
    /// Did not answer, but is in the ARP/neighbour table.
    Neighbor,
}

/// Where a host's name came from.
///
/// A separate axis from [`FoundBy`], which answers how the host itself was
/// found. Merging the two would make both harder to read: a host can be found
/// by probe and named by mDNS, or found in the neighbour table and named by
/// reverse DNS, in any combination.
///
/// Reported because the two sources mean different things. A reverse-DNS name
/// is what the network's own resolver calls the host; an mDNS name is what the
/// device calls itself, which is usually friendlier and occasionally a
/// marketing string. Neither is authoritative, and a reader deciding whether
/// to trust one needs to know which it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NameSource {
    /// Reverse DNS, or LLMNR/NetBIOS via `ping -a` on Windows.
    Reverse,
    /// The host's own mDNS/DNS-SD announcement.
    Mdns,
}

#[derive(Debug, Clone, Serialize)]
pub struct Host {
    pub ip: IpAddr,
    pub hostname: Option<String>,
    pub mac: Option<String>,
    pub vendor: Option<String>,
    pub rtt_ms: Option<u64>,
    /// Additive field: existing consumers that ignore it are unaffected.
    pub found_by: FoundBy,
    /// Which lookup produced `hostname`, or `None` when there is no name.
    /// Additive, like `found_by`.
    pub hostname_source: Option<NameSource>,
}

/// How long the mDNS browse that runs alongside a discover listens for.
///
/// Measured on an ordinary home LAN rather than picked: unique hosts reached
/// their ceiling of 7 at 1000ms and did not move at 1500, 2000 or 3000ms,
/// while 500ms was unstable across repeat runs (3 hosts, then 5) and 250ms
/// returned nothing at all twice. 1500 sits past the plateau with margin for a
/// slower network, and well under the 3000ms the explicit `/mdns` browse uses
/// -- that one is a deliberate "go and look", this one rides along.
///
/// It bounds the only case where this costs anything. The browse starts with
/// the ping sweep, so on any real subnet it has long finished by the time the
/// sweep has; the window is only visible when the sweep finishes first, on a
/// /30 or a near-empty range, and then it adds at most
/// `1500ms - sweep duration`.
#[cfg(feature = "mdns")]
const MDNS_FUSION_WINDOW_MS: u64 = 1500;

pub struct DiscoverEngine {
    ping_scanner: PingScanner,
    concurrency: usize,
    ping_timeout_ms: u64,
    dns_timeout_ms: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum DiscoverPhase {
    Ping,
    Resolve,
}

#[derive(Debug, Clone)]
pub struct DiscoverProgress {
    pub phase: DiscoverPhase,
    pub completed: usize,
    pub total: usize,
    pub found: usize,
    pub ip: IpAddr,
}

impl DiscoverEngine {
    pub fn new(concurrency: usize) -> Self {
        Self::new_with_timeouts(
            concurrency,
            crate::DEFAULT_PING_TIMEOUT_MS,
            crate::DEFAULT_DNS_TIMEOUT_MS,
        )
    }

    pub fn new_with_timeouts(
        concurrency: usize,
        ping_timeout_ms: u64,
        dns_timeout_ms: u64,
    ) -> Self {
        // Clamp both ends. `.max(1)` alone left the upper bound to
        // `Semaphore::new`, which asserts `permits <= usize::MAX >> 3` --
        // so a caller passing `usize::MAX` got a panic rather than an
        // error, from a constructor that returns `Self` and cannot report
        // one. Absurd input, but this is public API and a process abort is
        // the wrong failure mode for it.
        let concurrency = concurrency.clamp(1, crate::MAX_CONCURRENCY);
        Self {
            ping_scanner: PingScanner::new(concurrency),
            concurrency,
            ping_timeout_ms: ping_timeout_ms.max(1),
            dns_timeout_ms: dns_timeout_ms.max(1),
        }
    }

    pub async fn scan_subnet(&self, subnet: Ipv4Net, resolve: bool) -> Result<Vec<Host>> {
        self.scan_subnet_with_progress(subnet, resolve, None).await
    }

    /// Ping-sweep a subnet, then resolve names for the hosts that answered.
    ///
    /// Enforces the /16 cap itself rather than trusting the caller. This is
    /// public API re-exported at the crate root, and it used to collect every
    /// address of whatever `Ipv4Net` it was given straight into a `Vec` --
    /// `0.0.0.0/0` is 4,294,967,294 entries, roughly 73 GB, allocated before
    /// a single packet is sent. `Ops` checked, the engine did not.
    pub async fn scan_subnet_with_progress(
        &self,
        subnet: Ipv4Net,
        resolve: bool,
        progress: Option<Arc<dyn Fn(DiscoverProgress) + Send + Sync>>,
    ) -> Result<Vec<Host>> {
        crate::ops::validation::ensure_subnet_limit(&subnet, &subnet.to_string())?;
        let ips: Vec<IpAddr> = subnet.hosts().map(IpAddr::V4).collect();

        // 0) Start listening for mDNS now, so the browse overlaps everything
        // below instead of following it.
        //
        // This is the whole reason discover can name a Hue bridge or a
        // Raspberry Pi. Consumer routers do not serve PTR records for their
        // own DHCP clients, and appliances ignore LLMNR and NetBIOS, so the
        // reverse lookup in step 3 comes back empty for exactly the devices
        // someone opened the app to identify -- while those same devices are
        // announcing their names over mDNS the entire time.
        //
        // Spawned rather than awaited: a browse is a fixed listening window,
        // not work that finishes early, so the only way it costs nothing is
        // to run it against the clock the sweep is already spending.
        #[cfg(feature = "mdns")]
        let mdns_browse = tokio::spawn(crate::mdns::MdnsEngine::discover_common(
            std::time::Duration::from_millis(MDNS_FUSION_WINDOW_MS),
        ));

        // 1) Ping first (fast), to avoid reverse-DNS work on dead hosts.
        let total = ips.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let found = Arc::new(AtomicUsize::new(0));
        let ping_results = stream::iter(ips)
            .map(|ip| {
                let scanner = self.ping_scanner.clone();
                let timeout_ms = self.ping_timeout_ms;
                let completed = completed.clone();
                let found = found.clone();
                let progress = progress.clone();
                async move {
                    let res = scanner.ping(ip, timeout_ms).await;
                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    // Capture `found` *after* both atomic updates settle.
                    // Using a single load for both branches avoids the
                    // previous inconsistency where an unreachable IP could
                    // be reported with a `found` count that was updated by
                    // a concurrent task between this task's two loads.
                    if res.alive {
                        found.fetch_add(1, Ordering::SeqCst);
                    }
                    let found_snapshot = found.load(Ordering::SeqCst);

                    if let Some(cb) = &progress {
                        if res.alive || done == total || done.is_multiple_of(10) {
                            cb(DiscoverProgress {
                                phase: DiscoverPhase::Ping,
                                completed: done,
                                total,
                                found: found_snapshot,
                                ip,
                            });
                        }
                    }

                    res
                }
            })
            .buffer_unordered(self.concurrency)
            .collect::<Vec<crate::ping::PingResult>>()
            .await;

        let alive: Vec<crate::ping::PingResult> =
            ping_results.into_iter().filter(|r| r.alive).collect();

        // 2) Load ARP/neighbor table once and reuse it.
        //
        // On a blocking thread: this shells out to `arp` on Windows and
        // macOS, and running it inline parked a runtime worker on the child
        // process for every discover and sweep.
        let arp_map: HashMap<IpAddr, crate::arp::ArpEntry> =
            tokio::task::spawn_blocking(NetworkManager::get_arp_table)
                .await
                .unwrap_or_else(|_| Ok(Vec::new()))
                .unwrap_or_default()
                .into_iter()
                .map(|e| (e.ip, e))
                .collect();

        // 3) Optionally reverse-DNS alive hosts using a single resolver.
        let hostname_map: HashMap<IpAddr, Option<String>> = if resolve {
            let ips = alive.iter().map(|r| r.ip).collect::<Vec<_>>();
            let concurrency = self.concurrency.min(32);
            let total = ips.len();
            let completed = Arc::new(AtomicUsize::new(0));
            let resolved = Arc::new(AtomicUsize::new(0));
            stream::iter(ips)
                .map(|ip| {
                    let dns_timeout_ms = self.dns_timeout_ms;
                    let completed = completed.clone();
                    let resolved = resolved.clone();
                    let progress = progress.clone();
                    async move {
                        let name =
                            crate::dns::reverse_lookup_best_effort_timeout(ip, dns_timeout_ms)
                                .await;
                        let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        if name.is_some() {
                            resolved.fetch_add(1, Ordering::SeqCst);
                        }
                        let resolved_count = resolved.load(Ordering::SeqCst);

                        if let Some(cb) = &progress {
                            if name.is_some() || done == total || done.is_multiple_of(5) {
                                cb(DiscoverProgress {
                                    phase: DiscoverPhase::Resolve,
                                    completed: done,
                                    total,
                                    found: resolved_count,
                                    ip,
                                });
                            }
                        }

                        (ip, name)
                    }
                })
                .buffer_unordered(concurrency)
                .collect::<Vec<(IpAddr, Option<String>)>>()
                .await
                .into_iter()
                .collect()
        } else {
            HashMap::new()
        };

        // 4) Fuse in mDNS names, for hosts the reverse lookup left unnamed.
        //
        // Fill-blanks-only, deliberately. A host that already resolved keeps
        // the name the network's resolver gave it, so nothing that works
        // today changes under anyone comparing runs or scripting the output.
        // The change is additive in effect as well as in shape.
        //
        // Every name goes through the same `normalize_hostname` the reverse
        // lookups use, and that is not tidiness. An mDNS name is a string
        // chosen by whoever runs the other machine, exactly like a PTR record
        // or an LLMNR reply -- untrusted remote text, which ARCHITECTURE.md
        // requires be treated as data and never as control. That function
        // rejects names carrying control characters, which is what stops a
        // device calling itself an escape sequence from repainting a terminal
        // or forging the row above it.
        //
        // A failed or unavailable browse is not an error here: no mDNS means
        // the same empty column as before, which is the behaviour this is
        // improving on rather than a regression to report.
        #[cfg(feature = "mdns")]
        let mdns_names: HashMap<IpAddr, String> = match mdns_browse.await {
            Ok(Ok(services)) => services
                .into_iter()
                .filter_map(|service| {
                    crate::dns::normalize_hostname(service.hostname)
                        .map(|name| (service.addresses, name))
                })
                .flat_map(|(addresses, name)| {
                    addresses.into_iter().map(move |ip| (ip, name.clone()))
                })
                .collect(),
            _ => HashMap::new(),
        };

        let build = |ip: IpAddr, rtt_ms: Option<u64>, found_by: FoundBy| {
            let mac_entry = arp_map.get(&ip);
            let mac_str = mac_entry.map(|e| e.mac.to_string());
            let vendor = mac_entry
                .and_then(|e| e.vendor.clone())
                .or_else(|| mac_str.as_deref().and_then(lookup_vendor));
            let reverse_name = hostname_map.get(&ip).cloned().unwrap_or(None);
            #[cfg(feature = "mdns")]
            let (hostname, hostname_source) = match reverse_name {
                Some(name) => (Some(name), Some(NameSource::Reverse)),
                None => match mdns_names.get(&ip) {
                    Some(name) => (Some(name.clone()), Some(NameSource::Mdns)),
                    None => (None, None),
                },
            };
            #[cfg(not(feature = "mdns"))]
            let (hostname, hostname_source) = match reverse_name {
                Some(name) => (Some(name), Some(NameSource::Reverse)),
                None => (None, None),
            };
            Host {
                ip,
                hostname,
                mac: mac_str,
                vendor,
                rtt_ms,
                found_by,
                hostname_source,
            }
        };

        let mut hosts: Vec<Host> = alive
            .iter()
            .map(|r| build(r.ip, r.rtt_ms, FoundBy::Probe))
            .collect();

        // Anything the OS has an ARP entry for is on this link, whether or
        // not it answered us. Plenty of devices do not: consumer IoT
        // routinely ignores ICMP, and Windows drops echo requests by
        // default. Discarding them meant discovery reported a fraction of
        // the network -- measured at 13 of 25 known devices on one ordinary
        // LAN -- while the table needed to find them was already loaded, and
        // used only to decorate the hosts that had replied.
        let answered: std::collections::HashSet<IpAddr> = alive.iter().map(|r| r.ip).collect();
        let mut neighbors: Vec<IpAddr> = arp_map
            .keys()
            .copied()
            .filter(|ip| !answered.contains(ip))
            .filter(|ip| match ip {
                // Only within the range that was asked for. The neighbour
                // table spans every interface, so it holds addresses from
                // other subnets entirely.
                IpAddr::V4(v4) => subnet.contains(v4),
                IpAddr::V6(_) => false,
            })
            .collect();
        neighbors.sort_unstable();
        hosts.extend(
            neighbors
                .into_iter()
                .map(|ip| build(ip, None, FoundBy::Neighbor)),
        );

        Ok(hosts)
    }
}
