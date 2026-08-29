use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use netscli_core::PcapCancelToken;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub(crate) struct OperationManager {
    tasks: Arc<AsyncMutex<HashMap<String, OperationHandle>>>,
}

#[derive(Default)]
pub(crate) struct ArtifactRegistry {
    paths: Mutex<HashSet<PathBuf>>,
}

pub(crate) struct OperationHandle {
    task: tauri::async_runtime::JoinHandle<()>,
    pcap_cancel: Option<PcapCancelToken>,
}

impl OperationManager {
    pub(crate) async fn register(
        &self,
        op_id: String,
        task: tauri::async_runtime::JoinHandle<()>,
        pcap_cancel: Option<PcapCancelToken>,
    ) {
        let mut tasks = self.tasks.lock().await;

        // If an op_id is re-used, cancel the previous one.
        if let Some(prev) = tasks.insert(op_id, OperationHandle { task, pcap_cancel }) {
            if let Some(token) = prev.pcap_cancel {
                token.cancel();
            }
            prev.task.abort();
        }
    }

    /// An owned handle to the task map, for cleanup that has to outlive the
    /// borrow of this state.
    ///
    /// `run_json_operation` holds a `tauri::State`, which cannot be moved
    /// into a `Drop` impl. Without one, an operation whose invoke future was
    /// dropped -- a webview reload mid-run -- never reached the `remove`
    /// after its `await`, so its entry stayed in the map for the life of the
    /// process.
    pub(crate) fn registry(&self) -> Arc<AsyncMutex<HashMap<String, OperationHandle>>> {
        Arc::clone(&self.tasks)
    }

    /// Whether an operation is still registered.
    ///
    /// `cancel` removes the entry before aborting the task, so an operation
    /// whose task ended without producing a result while still registered was
    /// not cancelled -- it died on its own. That is the only way to tell the
    /// two apart from `run_json_operation`, which sees an identical dropped
    /// sender either way.
    ///
    /// `register` also aborts a task when an op id is re-used, which would
    /// look the same. Op ids are UUIDs minted per run (`generateId('op')`), so
    /// that path is unreachable in practice.
    pub(crate) async fn is_registered(&self, op_id: &str) -> bool {
        self.tasks.lock().await.contains_key(op_id)
    }

    pub(crate) async fn cancel(&self, op_id: &str) -> bool {
        let mut tasks = self.tasks.lock().await;
        if let Some(handle) = tasks.remove(op_id) {
            if let Some(token) = handle.pcap_cancel {
                token.cancel();
            }
            handle.task.abort();
            true
        } else {
            false
        }
    }
}

impl ArtifactRegistry {
    pub(crate) fn register(&self, path: &Path) -> Result<(), String> {
        let path = canonical_artifact_path(path)?;
        let mut paths = self
            .paths
            .lock()
            .map_err(|_| "Artifact registry lock poisoned".to_string())?;
        paths.insert(path);
        Ok(())
    }

    pub(crate) fn contains(&self, path: &Path) -> Result<bool, String> {
        let path = canonical_artifact_path(path)?;
        let paths = self
            .paths
            .lock()
            .map_err(|_| "Artifact registry lock poisoned".to_string())?;
        Ok(paths.contains(&path))
    }
}

fn canonical_artifact_path(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path).map_err(|e| format!("Artifact path is not accessible: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The invariant `run_json_operation` leans on to tell a cancelled
    /// operation from one that died on its own.
    ///
    /// Both drop the oneshot sender, so the receiver sees the same error
    /// either way, and both were reported to the user as "Operation
    /// cancelled" -- a panic in the scanner was indistinguishable from
    /// pressing Stop. The difference is here: `cancel` removes the entry
    /// before aborting, while a task that ends by itself leaves it behind.
    #[tokio::test]
    async fn cancel_deregisters_and_a_task_ending_by_itself_does_not() {
        let manager = OperationManager::default();

        let never_finishes = tauri::async_runtime::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        manager.register("op-cancelled".into(), never_finishes, None).await;
        assert!(manager.is_registered("op-cancelled").await);

        assert!(manager.cancel("op-cancelled").await);
        assert!(
            !manager.is_registered("op-cancelled").await,
            "a cancelled operation must leave the map, or a real cancel reads as a crash"
        );

        let finishes = tauri::async_runtime::spawn(async {});
        manager.register("op-finished".into(), finishes, None).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        assert!(
            manager.is_registered("op-finished").await,
            "a task that ended on its own must stay registered, or a crash reads as a cancel"
        );
    }
}
