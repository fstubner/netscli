mod connect;
mod constants;
#[cfg(unix)]
mod fd_limit;
mod network;
mod ports;
// Windows-only. On Unix `exec` searches PATH alone, so there is nothing to
// resolve, and a non-Windows variant is dead code that `-D warnings`
// rejects -- which is exactly how CI caught the first attempt at this.
#[cfg(windows)]
mod system_tools;
mod terminal;

pub(crate) use connect::connect as tcp_connect;

/// See `fd_limit`. Nothing to do where there is no `RLIMIT_NOFILE`.
pub(crate) fn raise_open_file_limit() {
    #[cfg(unix)]
    fd_limit::raise_open_file_limit();
}
pub use constants::{
    DEFAULT_CONCURRENCY, DEFAULT_DNS_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS, DEFAULT_PORTS,
    DEFAULT_SCAN_TIMEOUT_MS, DEFAULT_SUBNET, MAX_MDNS_TIMEOUT_MS, MAX_PING_COUNT,
};
pub use network::{
    default_ipv4_subnet_string, detect_default_ipv4_addr, detect_default_ipv4_subnet,
};
pub use ports::{
    default_ports, parse_ports, parse_ports_checked, validate_ports, MAX_PORTS_PER_SCAN,
};
#[cfg(windows)]
pub(crate) use system_tools::system_tool;
pub use terminal::{is_unsafe_for_display, sanitize_for_terminal};
