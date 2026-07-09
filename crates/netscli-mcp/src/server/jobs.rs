use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;

pub(super) type PcapJobHandle = Arc<Mutex<PcapCaptureJob>>;

#[derive(Debug)]
pub(super) struct PcapCaptureJob {
    started_at: Instant,
    finished_at: Option<Instant>,
    outcome: Option<Result<netscli_core::PcapResult, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PcapJobStatus {
    pub(super) job_id: String,
    pub(super) status: &'static str,
    pub(super) running: bool,
    pub(super) elapsed_ms: u64,
    pub(super) result_available: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) result: Option<netscli_core::PcapResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

impl PcapCaptureJob {
    pub(super) fn new() -> Self {
        Self {
            started_at: Instant::now(),
            finished_at: None,
            outcome: None,
        }
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
            result,
            error,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        let end = self.finished_at.unwrap_or_else(Instant::now);
        end.duration_since(self.started_at).as_millis() as u64
    }
}
