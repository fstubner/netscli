use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use netscli_core::PcapCancelToken;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub(crate) struct OperationManager {
    tasks: AsyncMutex<HashMap<String, OperationHandle>>,
}

#[derive(Default)]
pub(crate) struct ArtifactRegistry {
    paths: Mutex<HashSet<PathBuf>>,
}

struct OperationHandle {
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

    pub(crate) async fn remove(&self, op_id: &str) {
        let mut tasks = self.tasks.lock().await;
        tasks.remove(op_id);
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
