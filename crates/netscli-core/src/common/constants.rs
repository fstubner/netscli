pub const DEFAULT_SUBNET: &str = "192.168.1.0/24";
pub const DEFAULT_PORTS: &[u16] = &[22, 80, 443];
pub const DEFAULT_CONCURRENCY: usize = 256;
pub const DEFAULT_SCAN_TIMEOUT_MS: u64 = 500;
pub const DEFAULT_PING_TIMEOUT_MS: u64 = 1000;
pub const DEFAULT_DNS_TIMEOUT_MS: u64 = 1500;

/// Longest an mDNS browse will run.
///
/// This was the one engine knob with no core-side ceiling: `netscli mdns
/// --timeout-ms 86400000` blocked for a day. The TUI clamped to this value
/// itself, which is exactly the per-surface divergence the limits in this
/// crate exist to prevent.
pub const MAX_MDNS_TIMEOUT_MS: u64 = 30_000;

/// Most pings a single `ping_host_summary` call will send.
///
/// The loop is sequential and each iteration waits up to `ping_timeout_ms`,
/// so an unbounded count multiplies straight into wall-clock time: 256 pings
/// at the 10-minute ceiling is roughly 42 hours. Every other engine knob is
/// clamped in core; this one was not.
pub const MAX_PING_COUNT: u32 = 256;
