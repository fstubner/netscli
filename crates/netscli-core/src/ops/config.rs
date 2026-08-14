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

/// Upper bound on in-flight probes.
///
/// Exported so callers clamp to the same value rather than guessing: the MCP
/// server used to clamp to 4096 here, which meant 1025..=4096 was accepted at
/// the API boundary and then silently reduced by `Ops::new` (C-10).
pub const MAX_CONCURRENCY: usize = 1024;

impl Ops {
    pub fn new(cfg: OpsConfig) -> Self {
        let mut cfg = cfg;
        // Lower bound prevents semaphore deadlock; the upper bound stops users
        // from triggering kernel ephemeral-port exhaustion on aggressive
        // --concurrency values.
        cfg.concurrency = cfg.concurrency.clamp(1, MAX_CONCURRENCY);
        cfg.scan_timeout_ms = cfg.scan_timeout_ms.max(1);
        cfg.ping_timeout_ms = cfg.ping_timeout_ms.max(1);
        cfg.dns_timeout_ms = cfg.dns_timeout_ms.max(1);
        Self { cfg }
    }

    pub fn config(&self) -> &OpsConfig {
        &self.cfg
    }
}
