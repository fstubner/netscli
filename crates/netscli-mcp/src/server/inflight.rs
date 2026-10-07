//! Requests still running, so a client can cancel one.
//!
//! MCP clients send `notifications/cancelled` with the `requestId` of a call
//! they no longer want, for example when the user stops a model mid-answer.
//! The server used to ignore it: a sweep carried on to the end, holding one of
//! the sixteen request slots and sending probes nobody would read. Now the
//! request's task is aborted, and, as the protocol asks, no response is sent
//! for it.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde_json::Value;
use tokio::task::AbortHandle;

#[derive(Default)]
pub(super) struct InFlight(Mutex<HashMap<String, AbortHandle>>);

/// One key per JSON-RPC id. The id's JSON text keeps `1` and `"1"` apart,
/// which JSON-RPC treats as different ids.
pub(super) fn key(id: &Value) -> String {
    id.to_string()
}

impl InFlight {
    fn map(&self) -> MutexGuard<'_, HashMap<String, AbortHandle>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Track a request while it is spawned. The lock is held across `spawn`
    /// so a task that finishes at once cannot call `finish` before its handle
    /// is recorded, which would leave the handle behind for good.
    pub(super) fn track(&self, key: String, spawn: impl FnOnce() -> AbortHandle) {
        let mut map = self.map();
        let handle = spawn();
        map.insert(key, handle);
    }

    /// The request answered; stop tracking it. Called from the request's own
    /// task, and removes the entry only if it is still that task's.
    ///
    /// The key alone is not enough. A client may reuse an id as soon as it
    /// has the answer, and a second request with an id already in flight
    /// replaces the first one's entry. Either way the entry under this key
    /// could belong to a newer request, and removing it left that request
    /// impossible to cancel.
    pub(super) fn finish(&self, key: &str) {
        let mut map = self.map();
        let own = map
            .get(key)
            .is_some_and(|handle| Some(handle.id()) == tokio::task::try_id());
        if own {
            map.remove(key);
        }
    }

    /// Handle `notifications/cancelled`. Returns whether a running request
    /// was stopped; an unknown or finished id is ignored, as the protocol
    /// expects, since the response may already be on its way.
    pub(super) fn cancel(&self, params: Option<&Value>) -> bool {
        let Some(id) = params.and_then(|p| p.get("requestId")) else {
            return false;
        };
        match self.map().remove(&key(id)) {
            Some(handle) => {
                handle.abort();
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;

    #[tokio::test]
    async fn cancelling_a_running_request_aborts_it() {
        let inflight = InFlight::default();
        let mut set = tokio::task::JoinSet::new();
        inflight.track(key(&json!(5)), || {
            set.spawn(async { tokio::time::sleep(Duration::from_secs(60)).await })
        });
        assert!(inflight.cancel(Some(&json!({"requestId": 5, "reason": "user stopped"}))));
        let joined = tokio::time::timeout(Duration::from_secs(1), set.join_next()).await;
        let outcome = joined.expect("cancel must end the task promptly").unwrap();
        assert!(outcome.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn a_finished_request_does_not_untrack_a_newer_one_with_its_id() {
        let inflight = std::sync::Arc::new(InFlight::default());
        let mut set = tokio::task::JoinSet::new();
        let (finish_old, finished) = tokio::sync::oneshot::channel::<()>();
        let tracker = std::sync::Arc::clone(&inflight);
        inflight.track(key(&json!(1)), || {
            set.spawn(async move {
                let _ = finished.await;
                tracker.finish(&key(&json!(1)));
            })
        });
        // The client reuses the id while the first request is still
        // finishing, which replaces the entry.
        inflight.track(key(&json!(1)), || {
            set.spawn(async { tokio::time::sleep(Duration::from_secs(60)).await })
        });

        finish_old.send(()).unwrap();
        let first = tokio::time::timeout(Duration::from_secs(1), set.join_next()).await;
        assert!(first.expect("the first request finishes").unwrap().is_ok());

        assert!(
            inflight.cancel(Some(&json!({"requestId": 1}))),
            "the newer request must still be cancellable"
        );
    }

    #[test]
    fn unknown_or_finished_ids_are_ignored() {
        let inflight = InFlight::default();
        assert!(!inflight.cancel(Some(&json!({"requestId": 9}))));
        assert!(!inflight.cancel(Some(&json!({}))));
        assert!(!inflight.cancel(None));
    }

    #[test]
    fn numeric_and_string_ids_are_different_requests() {
        assert_ne!(key(&json!(1)), key(&json!("1")));
    }
}
