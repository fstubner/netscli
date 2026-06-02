use crate::{
    DEFAULT_CONCURRENCY, DEFAULT_DNS_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS, DEFAULT_SCAN_TIMEOUT_MS,
};

#[derive(Debug, Clone)]
pub struct OpsConfig {
    pub concurrency: usize,
    pub scan_timeout_ms: u64,
    pub ping_timeout_ms: u64,
    pub dns_timeout_ms: u64,
}

impl Default for OpsConfig {
    fn default() -> Self {
        Self {
            concurrency: DEFAULT_CONCURRENCY,
            scan_timeout_ms: DEFAULT_SCAN_TIMEOUT_MS,
            ping_timeout_ms: DEFAULT_PING_TIMEOUT_MS,
            dns_timeout_ms: DEFAULT_DNS_TIMEOUT_MS,
        }
    }
}

/// High-level operations used by CLI/TUI/GUI/MCP to keep behavior consistent.
#[derive(Debug, Clone, Default)]
pub struct Ops {
    pub(super) cfg: OpsConfig,
}

impl Ops {
    pub fn new(cfg: OpsConfig) -> Self {
        let mut cfg = cfg;
        // Clamp [1, 1024]. Lower bound prevents semaphore deadlock; upper
        // bound matches the MCP server's existing per-call clamp and stops
        // users from triggering kernel ephemeral-port exhaustion on aggressive
        // --concurrency values.
        cfg.concurrency = cfg.concurrency.clamp(1, 1024);
        cfg.scan_timeout_ms = cfg.scan_timeout_ms.max(1);
        cfg.ping_timeout_ms = cfg.ping_timeout_ms.max(1);
        cfg.dns_timeout_ms = cfg.dns_timeout_ms.max(1);
        Self { cfg }
    }

    pub fn config(&self) -> &OpsConfig {
        &self.cfg
    }
}
