//! The shapes a discover returns.
//!
//! Split from `discover.rs` so that file stays the sweep engine: these are
//! the public data types every surface reads -- the CLI formatter, the TUI,
//! the desktop app and the MCP schema -- and they change for different
//! reasons than the scan logic does.

use serde::Serialize;
use std::net::IpAddr;

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
/// A separate axis from [`FoundBy`], not more variants on it: a host can be
/// found by probe and named by mDNS, or found in the neighbour table and
/// named by reverse DNS, in any combination. Worth reporting because a
/// reverse name is what the network calls the host and an mDNS name is what
/// the device calls itself -- neither authoritative, and a reader judging one
/// needs to know which it is.
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
