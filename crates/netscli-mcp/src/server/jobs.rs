use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;

use super::dispatch::ServerState;
use super::errors::RpcError;
use super::operations::{run_pcap_capture, validate_pcap_capture_params};
use super::schemas::{parse_params, PcapJobParams, PcapParams};

pub(super) type PcapJobHandle = Arc<Mutex<PcapCaptureJob>>;
pub(super) type PcapJobMap = HashMap<String, PcapJobHandle>;

const MAX_RUNNING_PCAP_JOBS: usize = 4;
const MAX_STORED_PCAP_JOBS: usize = 16;
const MAX_COMPLETED_PCAP_JOBS: usize = 8;

#[derive(Debug)]
pub(super) struct PcapCaptureJob {
    started_at: Instant,
    finished_at: Option<Instant>,
    outcome: Option<Result<netscli_core::PcapResult, String>>,
    /// Reported from the start. With no `outputFile` the name is made up
    /// here, and a client had no way to learn it before the result.
    output_file: String,
    /// Stops the capture when the server shuts down.
    cancel: netscli_core::PcapCancelToken,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PcapJobStatus {
    pub(super) job_id: String,
    pub(super) status: &'static str,
    pub(super) running: bool,
    pub(super) elapsed_ms: u64,
    pub(super) result_available: bool,
    pub(super) output_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PcapJobResult {
    pub(super) job_id: String,
    pub(super) status: &'static str,
    pub(super) running: bool,
    pub(super) elapsed_ms: u64,
    pub(super) result_available: bool,
    pub(super) output_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) result: Option<netscli_core::PcapResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

impl PcapCaptureJob {
    pub(super) fn new(output_file: String) -> Self {
        Self {
            started_at: Instant::now(),
            finished_at: None,
            outcome: None,
            output_file,
            cancel: netscli_core::PcapCancelToken::new(),
        }
    }

    pub(super) fn cancel_token(&self) -> netscli_core::PcapCancelToken {
        self.cancel.clone()
    }

    pub(super) fn complete(&mut self, result: netscli_core::PcapResult) {
        self.finished_at = Some(Instant::now());
        self.outcome = Some(Ok(result));
    }

    pub(super) fn fail(&mut self, error: String) {
        self.finished_at = Some(Instant::now());
        self.outcome = Some(Err(error));
    }

    pub(super) fn is_running(&self) -> bool {
        self.outcome.is_none()
    }

    pub(super) fn finished_at(&self) -> Option<Instant> {
        self.finished_at
    }

    pub(super) fn status(&self, job_id: String) -> PcapJobStatus {
        let (status, running, result_available, error) = match &self.outcome {
            None => ("running", true, false, None),
            Some(Ok(_)) => ("completed", false, true, None),
            Some(Err(error)) => ("failed", false, false, Some(error.clone())),
        };

        PcapJobStatus {
            job_id,
            status,
            running,
            elapsed_ms: self.elapsed_ms(),
            result_available,
            output_file: self.output_file.clone(),
            error,
        }
    }

    pub(super) fn result(&self, job_id: String) -> PcapJobResult {
        let (status, running, result_available, result, error) = match &self.outcome {
            None => ("running", true, false, None, None),
            Some(Ok(result)) => ("completed", false, true, Some(result.clone()), None),
            Some(Err(error)) => ("failed", false, false, None, Some(error.clone())),
        };

        PcapJobResult {
            job_id,
            status,
            running,
            elapsed_ms: self.elapsed_ms(),
            result_available,
            output_file: self.output_file.clone(),
            result,
            error,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        let end = self.finished_at.unwrap_or_else(Instant::now);
        end.duration_since(self.started_at).as_millis() as u64
    }
}

impl ServerState {
    pub(super) fn allocate_pcap_job_id(&mut self) -> String {
        self.next_pcap_job_id = self.next_pcap_job_id.saturating_add(1);
        format!("pcap-{}", self.next_pcap_job_id)
    }

    pub(super) fn pcap_job(&self, job_id: &str) -> Result<PcapJobHandle, RpcError> {
        self.pcap_jobs
            .get(job_id)
            .cloned()
            .ok_or_else(|| RpcError::InvalidParams(format!("unknown pcap jobId: {job_id}")))
    }

    /// Stop every running capture, for shutdown. A job outlives the request
    /// that started it, so nothing else stops it when the client goes.
    pub(super) fn stop_pcap_jobs(&self) {
        for job in self.pcap_jobs.values() {
            if let Ok(job) = job.lock() {
                job.cancel.cancel();
            }
        }
    }

    pub(super) fn running_pcap_jobs(&self) -> usize {
        self.pcap_jobs
            .values()
            .filter(|job| job.lock().map(|guard| guard.is_running()).unwrap_or(true))
            .count()
    }

    pub(super) fn prune_pcap_jobs(&mut self) {
        let mut finished: Vec<(String, Instant)> = self
            .pcap_jobs
            .iter()
            .filter_map(|(job_id, job)| {
                let finished_at = job.lock().ok()?.finished_at()?;
                Some((job_id.clone(), finished_at))
            })
            .collect();

        finished.sort_by_key(|(_, finished_at)| *finished_at);
        let remove_count = self
            .pcap_jobs
            .len()
            .saturating_sub(MAX_STORED_PCAP_JOBS)
            .max(finished.len().saturating_sub(MAX_COMPLETED_PCAP_JOBS))
            .min(finished.len());

        for (job_id, _) in finished.into_iter().take(remove_count) {
            self.pcap_jobs.remove(&job_id);
        }
    }
}

// Not `async`: the body only spawns the capture and returns its initial
// status. Keeping it synchronous lets the caller hold the (synchronous)
// server-state lock across the whole call without making the enclosing
// future non-`Send`.
pub(super) fn start_pcap_capture_job(
    state: &mut ServerState,
    params: Value,
) -> Result<Value, RpcError> {
    let p: PcapParams = parse_params(params)?;
    let mut request = validate_pcap_capture_params(p)?;
    state.prune_pcap_jobs();
    if state.running_pcap_jobs() >= MAX_RUNNING_PCAP_JOBS {
        return Err(RpcError::ToolError(format!(
            "too many pcap captures are already running (max {MAX_RUNNING_PCAP_JOBS})"
        )));
    }
    let job_id = state.allocate_pcap_job_id();
    // Timestamped, because the job counter restarts at 1 with the process:
    // two runs of the server both chose `netscli-pcap-1.pcap`. The file is
    // created here, so a name that is taken fails this call rather than the
    // job later.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let output_file = request.claim_output_file(format!("netscli-{job_id}-{stamp}.pcap"))?;
    let job = PcapCaptureJob::new(output_file);
    let cancel = job.cancel_token();
    let job = Arc::new(Mutex::new(job));
    state.pcap_jobs.insert(job_id.clone(), job.clone());

    tokio::spawn(async move {
        let outcome = run_pcap_capture(request, cancel).await;
        let Ok(mut guard) = job.lock() else {
            return;
        };
        match outcome {
            Ok(result) => guard.complete(result),
            Err(err) => guard.fail(err.to_string()),
        }
    });

    let job = state.pcap_job(&job_id)?;
    pcap_status_value(job_id, &job)
}

pub(super) fn pcap_job_status(state: &ServerState, params: Value) -> Result<Value, RpcError> {
    let p: PcapJobParams = parse_params(params)?;
    let job = state.pcap_job(&p.job_id)?;
    pcap_status_value(p.job_id, &job)
}

/// Fetch a finished capture's packets.
///
/// Capped here rather than relying on the choke point in `dispatch_tool`.
/// This is the one tool result that never passes through it: both
/// `handle_tools_call` and the legacy direct method route the pcap job tools
/// before `dispatch_tool` is reached, so the packets -- every byte of them
/// chosen by whatever is on the wire -- reached the model whole, while the
/// blocking `capture_pcap` tool beside it was capped. `start_pcap_capture`'s
/// own description steers callers to this path for long captures, and
/// `maxPackets` has no default, so "the recommended way to capture" was also
/// the only way to get unbounded remote text into a context window.
pub(super) fn pcap_job_result(state: &ServerState, params: Value) -> Result<Value, RpcError> {
    let p: PcapJobParams = parse_params(params)?;
    let job = state.pcap_job(&p.job_id)?;
    let guard = job
        .lock()
        .map_err(|_| RpcError::Internal("pcap job state lock poisoned".to_string()))?;
    let value = serde_json::to_value(guard.result(p.job_id))
        .map_err(|e| RpcError::Internal(e.to_string()))?;
    Ok(super::limits::cap_tool_result(value))
}

fn pcap_status_value(job_id: String, job: &PcapJobHandle) -> Result<Value, RpcError> {
    let guard = job
        .lock()
        .map_err(|_| RpcError::Internal("pcap job state lock poisoned".to_string()))?;
    serde_json::to_value(guard.status(job_id)).map_err(|e| RpcError::Internal(e.to_string()))
}

#[cfg(test)]
mod tests;
