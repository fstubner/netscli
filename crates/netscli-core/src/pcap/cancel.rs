use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Cooperative cancellation token for long-running PCAP capture loops.
///
/// This is intentionally very small and dependency-free so it can be used across
/// CLI/TUI/MCP/Tauri surfaces without pulling in additional async utilities.
#[derive(Debug, Clone, Default)]
pub struct PcapCancelToken {
    cancelled: Arc<AtomicBool>,
}

impl PcapCancelToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}
