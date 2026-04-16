use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::Networks;

#[derive(Debug, Clone, Serialize)]
pub struct NetworkStats {
    pub upload_mbps: f64,
    pub download_mbps: f64,
    pub upload_active: bool,
    pub download_active: bool,
    pub available: bool,
}

/// All mutable monitor state lives here so a single lock acquisition guarantees
/// a consistent snapshot (no interleaved reads between rate samples).
struct MonitorState {
    networks: Networks,
    selected_interface: Option<String>,
    /// Last time `get_stats()` ran and refreshed `networks`.
    last_update: Instant,
    /// (rx, tx) at `last_update` — used for activity detection.
    last_stats: (u64, u64),
    /// Most recent computed (upload_mbps, download_mbps).
    last_rates: (f64, f64),
    /// Last time we saw new (upload, download) bytes; drives active-indicator hold.
    last_active: (Instant, Instant),
    /// When each rate was last sampled for smoothing.
    last_rate_update: (Instant, Instant),
    /// (rx, tx) at `last_rate_update` — basis for the next rate computation.
    last_rate_stats: (u64, u64),
}

pub struct NetworkMonitor {
    state: Mutex<MonitorState>,
}

impl NetworkMonitor {
    const REFRESH_INTERVAL: Duration = Duration::from_millis(100);
    const RATE_INTERVAL: Duration = Duration::from_millis(400);
    const ACTIVE_HOLD: Duration = Duration::from_millis(200);

    pub fn new() -> Self {
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh();

        let (rx, tx, _) = sum_traffic(&networks, None);
        let now = Instant::now();
        let inactive = now - Self::ACTIVE_HOLD - Self::ACTIVE_HOLD;

        Self {
            state: Mutex::new(MonitorState {
                networks,
                selected_interface: None,
                last_update: now,
                last_stats: (rx, tx),
                last_rates: (0.0, 0.0),
                last_active: (inactive, inactive),
                last_rate_update: (now, now),
                last_rate_stats: (rx, tx),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MonitorState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_interface(&self, interface: Option<String>) {
        let mut s = self.lock();
        s.selected_interface = interface;
        s.networks.refresh();
        let (rx, tx, _) = sum_traffic(&s.networks, s.selected_interface.as_deref());

        let now = Instant::now();
        let inactive = now - Self::ACTIVE_HOLD - Self::ACTIVE_HOLD;

        s.last_update = now;
        s.last_stats = (rx, tx);
        s.last_rates = (0.0, 0.0);
        s.last_active = (inactive, inactive);
        s.last_rate_update = (now, now);
        s.last_rate_stats = (rx, tx);
    }

    pub fn selected_interface(&self) -> Option<String> {
        self.lock().selected_interface.clone()
    }

    pub fn available_interfaces(&self) -> Vec<String> {
        let mut s = self.lock();
        s.networks.refresh();
        let mut names: Vec<String> = s.networks.keys().map(|n| n.to_string()).collect();
        names.sort_unstable();
        names
    }

    pub fn get_stats(&self) -> NetworkStats {
        let mut s = self.lock();
        let now = Instant::now();
        let elapsed = now.duration_since(s.last_update);

        // Throttle refreshes — frequent callers (TUI ticks) get cached rates
        // to avoid noisy rate spikes from tiny sampling intervals.
        if elapsed < Self::REFRESH_INTERVAL {
            let (upload_mbps, download_mbps) = s.last_rates;
            return NetworkStats {
                upload_mbps,
                download_mbps,
                upload_active: now.duration_since(s.last_active.0) < Self::ACTIVE_HOLD,
                download_active: now.duration_since(s.last_active.1) < Self::ACTIVE_HOLD,
                available: true,
            };
        }

        s.networks.refresh();
        let (current_rx, current_tx, available) =
            sum_traffic(&s.networks, s.selected_interface.as_deref());
        if !available {
            return NetworkStats {
                upload_mbps: 0.0,
                download_mbps: 0.0,
                upload_active: false,
                download_active: false,
                available: false,
            };
        }

        // Activity detection — any byte since last refresh keeps the light on.
        let (seen_rx, seen_tx) = s.last_stats;
        if current_tx.saturating_sub(seen_tx) > 0 {
            s.last_active.0 = now;
        }
        if current_rx.saturating_sub(seen_rx) > 0 {
            s.last_active.1 = now;
        }
        s.last_stats = (current_rx, current_tx);

        // Smoothed rates: recompute only every RATE_INTERVAL to avoid jitter
        // from sub-100ms sampling windows.
        let (mut upload_mbps, mut download_mbps) = s.last_rates;
        let (mut last_upload, mut last_download) = s.last_rate_update;
        let (mut rate_rx, mut rate_tx) = s.last_rate_stats;

        if now.duration_since(last_upload) >= Self::RATE_INTERVAL {
            upload_mbps = bytes_to_mbps(
                current_tx.saturating_sub(rate_tx),
                now.duration_since(last_upload),
            );
            rate_tx = current_tx;
            last_upload = now;
        }
        if now.duration_since(last_download) >= Self::RATE_INTERVAL {
            download_mbps = bytes_to_mbps(
                current_rx.saturating_sub(rate_rx),
                now.duration_since(last_download),
            );
            rate_rx = current_rx;
            last_download = now;
        }

        s.last_update = now;
        s.last_rate_update = (last_upload, last_download);
        s.last_rate_stats = (rate_rx, rate_tx);
        s.last_rates = (upload_mbps, download_mbps);

        NetworkStats {
            upload_mbps,
            download_mbps,
            upload_active: now.duration_since(s.last_active.0) < Self::ACTIVE_HOLD,
            download_active: now.duration_since(s.last_active.1) < Self::ACTIVE_HOLD,
            available: true,
        }
    }
}

impl Default for NetworkMonitor {
    fn default() -> Self {
        Self::new()
    }
}

fn sum_traffic(networks: &Networks, selected: Option<&str>) -> (u64, u64, bool) {
    if let Some(selected) = selected {
        for (name, network) in networks {
            if name == selected {
                return (network.total_received(), network.total_transmitted(), true);
            }
        }
        return (0, 0, false);
    }

    let mut rx = 0;
    let mut tx = 0;
    let mut any = false;
    for (_, network) in networks {
        any = true;
        rx += network.total_received();
        tx += network.total_transmitted();
    }
    (rx, tx, any)
}

/// Convert a byte delta observed over `elapsed` into megabits-per-second.
///
/// Returns 0.0 on a zero-duration window. Previously this clamped to
/// 999.99 Mbps "to avoid display overflow" — that silently hides 1 GbE /
/// 10 GbE link activity on reasonably modern hosts, so we trust the caller
/// to format the number appropriately.
fn bytes_to_mbps(bytes: u64, elapsed: Duration) -> f64 {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 {
        return 0.0;
    }
    (bytes as f64 * 8.0) / (1_000_000.0 * secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_to_mbps_typical() {
        // 1_000_000 bytes in 1 second = 8 Mbps
        assert!((bytes_to_mbps(1_000_000, Duration::from_secs(1)) - 8.0).abs() < 1e-6);
    }

    #[test]
    fn bytes_to_mbps_zero_elapsed_safe() {
        assert_eq!(bytes_to_mbps(1_000_000, Duration::from_secs(0)), 0.0);
    }

    #[test]
    fn bytes_to_mbps_reports_true_value_for_gbe() {
        // 1.25 GB in 1s = 10 Gbps = 10_000 Mbps. Previously this was
        // silently clamped to 999.99 which hid gigabit+ link activity.
        let actual = bytes_to_mbps(1_250_000_000, Duration::from_secs(1));
        assert!(
            (actual - 10_000.0).abs() < 1.0,
            "expected ~10_000 Mbps, got {actual}"
        );
    }

    #[test]
    fn new_monitor_reports_available_on_refresh() {
        // Smoke test: constructing and calling get_stats should never panic
        // and should report `available=true` if any network interface exists
        // on the test host (all CI runners do).
        let monitor = NetworkMonitor::new();
        let stats = monitor.get_stats();
        // Not asserting `available` since some sandboxed CI may lack interfaces;
        // just ensuring the call path is sound.
        assert!(stats.upload_mbps >= 0.0 && stats.download_mbps >= 0.0);
    }

    #[test]
    fn selected_interface_round_trips() {
        let monitor = NetworkMonitor::new();
        assert_eq!(monitor.selected_interface(), None);
        monitor.set_interface(Some("lo0".to_string()));
        assert_eq!(monitor.selected_interface(), Some("lo0".to_string()));
        monitor.set_interface(None);
        assert_eq!(monitor.selected_interface(), None);
    }
}
