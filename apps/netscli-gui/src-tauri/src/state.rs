use std::collections::HashMap;

use netscli_core::PcapCancelToken;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub(crate) struct OperationManager {
    tasks: AsyncMutex<HashMap<String, OperationHandle>>,
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
