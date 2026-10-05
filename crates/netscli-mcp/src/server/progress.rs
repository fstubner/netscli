//! MCP progress notifications for long tool calls.
//!
//! A client that wants progress puts a `progressToken` in the request's
//! `_meta`. Without this, a sweep of a /24 ran for tens of seconds with no
//! sign of life, and the only feedback a model got was the final answer or a
//! timeout. With it, the server sends `notifications/progress` while the
//! scan runs.
//!
//! The reporter travels in a task-local rather than as a parameter: it is
//! set once around the request in `server.rs` and read only by the three
//! long operations in `operations.rs`, and threading it through the five
//! dispatch layers between them would change every signature on the way for
//! the benefit of the two ends.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

/// At most one notification per interval, plus the final one. A port scan
/// reports every port, and 4,096 notifications for one call would cost the
/// client more than the scan.
const MIN_INTERVAL: Duration = Duration::from_millis(250);

/// Progress is sent as thousandths of the whole call, so operations with
/// several phases (a sweep pings, resolves, then scans) still count up
/// monotonically, as the protocol requires.
const SCALE: u64 = 1000;

pub(super) struct Progress {
    token: Value,
    tx: UnboundedSender<String>,
    last: Mutex<(Option<Instant>, u64)>,
}

tokio::task_local! {
    static CURRENT: Option<Arc<Progress>>;
}

impl Progress {
    /// A reporter for a request whose params carry `_meta.progressToken`.
    pub(super) fn for_request(
        params: Option<&Value>,
        tx: &UnboundedSender<String>,
    ) -> Option<Arc<Self>> {
        let token = params?.get("_meta")?.get("progressToken")?;
        if !(token.is_string() || token.is_number()) {
            return None;
        }
        Some(Arc::new(Self {
            token: token.clone(),
            tx: tx.clone(),
            last: Mutex::new((None, 0)),
        }))
    }

    /// Report `fraction` (0.0 to 1.0) of the whole call done.
    fn report(&self, fraction: f64, message: String) {
        let value = ((fraction.clamp(0.0, 1.0)) * SCALE as f64).round() as u64;
        let Ok(mut last) = self.last.lock() else {
            return;
        };
        let (sent_at, sent_value) = *last;
        let finished = value >= SCALE;
        // Never repeat or go backwards, and do not flood.
        if value <= sent_value && sent_at.is_some() {
            return;
        }
        if !finished && sent_at.is_some_and(|at| at.elapsed() < MIN_INTERVAL) {
            return;
        }
        *last = (Some(Instant::now()), value);
        let note = json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": self.token,
                "progress": value,
                "total": SCALE,
                "message": message,
            }
        });
        let _ = self.tx.send(note.to_string());
    }
}

/// Run `fut` with `progress` as the current request's reporter.
pub(super) async fn scope<F: std::future::Future>(
    progress: Option<Arc<Progress>>,
    fut: F,
) -> F::Output {
    CURRENT.scope(progress, fut).await
}

/// A core progress callback that reports through the current request, or
/// `None` when the client asked for no progress. `describe` turns one core
/// event into the fraction of the call done and a short message.
pub(super) fn callback<T: 'static>(
    describe: impl Fn(&T) -> (f64, String) + Send + Sync + 'static,
) -> Option<Arc<dyn Fn(T) + Send + Sync>> {
    let progress = CURRENT.try_with(|p| p.clone()).ok().flatten()?;
    Some(Arc::new(move |event: T| {
        let (fraction, message) = describe(&event);
        progress.report(fraction, message);
    }))
}

/// Fraction `completed / total` of a phase that covers `[start, start + span)`
/// of the whole call.
pub(super) fn phase_fraction(start: f64, span: f64, completed: usize, total: usize) -> f64 {
    if total == 0 {
        return start + span;
    }
    start + span * (completed as f64 / total as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    fn sent(rx: &mut mpsc::UnboundedReceiver<String>) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok(line) = rx.try_recv() {
            out.push(serde_json::from_str(&line).unwrap());
        }
        out
    }

    #[test]
    fn no_token_means_no_reporter() {
        let (tx, _rx) = mpsc::unbounded_channel();
        assert!(Progress::for_request(Some(&json!({"name": "scan_ports"})), &tx).is_none());
        assert!(Progress::for_request(None, &tx).is_none());
    }

    #[test]
    fn notifications_count_up_and_are_throttled_but_the_last_always_goes() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let p =
            Progress::for_request(Some(&json!({"_meta": {"progressToken": "t1"}})), &tx).unwrap();
        for i in 0..=100 {
            p.report(f64::from(i) / 100.0, format!("step {i}"));
        }
        let notes = sent(&mut rx);
        // The first goes at once, the rest fall inside the interval, and the
        // final one is never held back.
        assert_eq!(notes.len(), 2, "{notes:?}");
        assert_eq!(notes[0]["params"]["progressToken"], "t1");
        assert_eq!(notes[1]["params"]["progress"], SCALE);
        assert_eq!(notes[1]["method"], "notifications/progress");
    }

    #[test]
    fn progress_never_goes_backwards() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let p = Progress::for_request(Some(&json!({"_meta": {"progressToken": 7}})), &tx).unwrap();
        p.report(0.5, "half".into());
        std::thread::sleep(MIN_INTERVAL);
        p.report(0.4, "earlier phase".into());
        assert_eq!(sent(&mut rx).len(), 1);
    }

    #[test]
    fn phases_map_onto_one_scale() {
        assert_eq!(phase_fraction(0.0, 0.3, 0, 254), 0.0);
        assert!((phase_fraction(0.3, 0.6, 127, 254) - 0.6).abs() < 1e-9);
        assert_eq!(phase_fraction(0.4, 0.6, 0, 0), 1.0);
    }
}
