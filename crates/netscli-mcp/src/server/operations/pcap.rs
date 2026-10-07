//! Packet-capture operations for the MCP surface.
//!
//! Split out of `operations.rs` when that file passed the size guard. This is
//! a natural seam rather than an arbitrary cut: every item here is gated on
//! the `pcap` feature, and together they are the only part of the tool
//! surface that writes a file and holds a capture slot.

use crate::server::errors::RpcError;
use crate::server::schemas::PcapParams;

#[cfg(feature = "pcap")]
#[derive(Debug)]
pub(in crate::server) struct PcapCaptureRequest {
    interface: String,
    filter: Option<String>,
    duration: Option<u64>,
    output_file: Option<String>,
    max_packets: Option<usize>,
}

#[cfg(feature = "pcap")]
impl PcapCaptureRequest {
    /// Create the output file now, named `default_name` if the client chose
    /// no name, and return the name.
    ///
    /// libpcap opens its file by name and truncates whatever is there.
    /// `capture_pcap` always wrote `capture.pcap` in the server's working
    /// directory, usually the user's project, so it replaced any file of that
    /// name, and a `capture.pcap` symlink committed to a repository sent the
    /// capture through the link to wherever it pointed, as root if the server
    /// ran elevated. `create_new` refuses anything already at the name, a
    /// symlink included, even one that points nowhere.
    pub(in crate::server) fn claim_output_file(
        &mut self,
        default_name: String,
    ) -> Result<String, RpcError> {
        let name = self.output_file.get_or_insert(default_name).clone();
        let created = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&name);
        match created {
            Ok(_) => Ok(name),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(RpcError::ToolError(format!(
                    "{name} already exists, and a capture never replaces a file. Choose another outputFile."
                )))
            }
            Err(e) => Err(RpcError::ToolError(format!("cannot create {name}: {e}"))),
        }
    }
}

/// A name for a blocking capture the client did not name. Every one used to
/// be `capture.pcap`, so each replaced the last.
#[cfg(feature = "pcap")]
fn unnamed_capture() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("netscli-capture-{millis}.pcap")
}

/// Longest a *blocking* `capture_pcap` call may run.
///
/// Core allows an hour, which is right for a capture written to a file and
/// collected later -- that is what `start_pcap_capture` is for. A synchronous
/// tool call is a different shape: it occupies a request slot for its whole
/// duration, and no client is usefully blocked for an hour.
#[cfg(feature = "pcap")]
const MAX_INTERACTIVE_CAPTURE_SECONDS: u64 = 120;

#[cfg(feature = "pcap")]
pub(in crate::server) fn validate_pcap_capture_params(
    p: PcapParams,
) -> Result<PcapCaptureRequest, RpcError> {
    if p.interface.trim().is_empty() {
        return Err(RpcError::InvalidParams("interface is required".to_string()));
    }
    // Clamped here as well as in core: an interactive tool call holding a
    // request permit for an hour is a different problem from a capture file
    // being too long, and the job API exists for the long case.
    let duration = p
        .duration
        .map(|seconds| seconds.min(MAX_INTERACTIVE_CAPTURE_SECONDS));
    let max_packets = match p.max_packets {
        Some(0) => {
            return Err(RpcError::InvalidParams(
                "maxPackets must be greater than 0".to_string(),
            ));
        }
        Some(n) => {
            if n > (usize::MAX as u64) {
                return Err(RpcError::InvalidParams("maxPackets too large".to_string()));
            }
            Some(n as usize)
        }
        None => None,
    };
    let output_file = p
        .output_file
        .map(validate_mcp_pcap_output_file)
        .transpose()?;
    Ok(PcapCaptureRequest {
        interface: p.interface,
        filter: p.filter,
        duration,
        output_file,
        max_packets,
    })
}

/// Concurrent captures, counted across both capture tools.
///
/// `MAX_RUNNING_PCAP_JOBS` only ever counted entries in the job map, which
/// `start_pcap_capture` populates and the blocking `capture_pcap` does not --
/// so the cap was bypassed by calling the other tool. The resource being
/// protected is the machine's capture capacity, which is a property of the
/// process rather than of one map, so the limit lives here where both paths
/// must pass through it.
#[cfg(feature = "pcap")]
static PCAP_CAPTURE_SLOTS: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(MAX_CONCURRENT_PCAP_CAPTURES);

#[cfg(feature = "pcap")]
pub(in crate::server) const MAX_CONCURRENT_PCAP_CAPTURES: usize = 4;

/// Run a capture until it ends or `cancel` is cancelled.
///
/// The capture itself runs on a blocking thread that dropping a future does
/// not reach. A cancel, the request ceiling and the client going away all
/// drop the future, and the capture used to carry on regardless, holding the
/// interface and writing its file for up to an hour.
#[cfg(feature = "pcap")]
pub(in crate::server) async fn run_pcap_capture(
    request: PcapCaptureRequest,
    cancel: netscli_core::PcapCancelToken,
) -> Result<netscli_core::PcapResult, RpcError> {
    let output_file = request.output_file.clone();
    let outcome = capture_in_slot(request, cancel).await;
    if outcome.is_err() {
        if let Some(name) = output_file {
            remove_if_empty(&name);
        }
    }
    outcome
}

#[cfg(feature = "pcap")]
async fn capture_in_slot(
    request: PcapCaptureRequest,
    cancel: netscli_core::PcapCancelToken,
) -> Result<netscli_core::PcapResult, RpcError> {
    // `try_acquire`, not `acquire`: waiting would hold one of the server's
    // request permits for however long the running captures take, which is
    // the wedge this limit exists to prevent. Refusing immediately tells the
    // client something actionable instead.
    let slot = PCAP_CAPTURE_SLOTS.try_acquire().map_err(|_| {
        RpcError::ToolError(format!(
            "too many packet captures are already running (max {MAX_CONCURRENT_PCAP_CAPTURES})"
        ))
    })?;
    let _stop = StopOnDrop(cancel.clone());
    // The slot belongs to a task that lives until the capture has really
    // returned, at most one read timeout (250 ms) after a cancel. Held by
    // this future it came back the moment the future was dropped, so
    // cancelling and restarting got past the limit with the old captures
    // still running.
    let capture = tokio::spawn(async move {
        let _slot = slot;
        netscli_core::Ops::default()
            .capture_pcap_async_with_cancel(
                request.interface,
                request.filter,
                request.duration,
                request.output_file,
                request.max_packets,
                Some(cancel),
            )
            .await
    });
    match capture.await {
        Ok(outcome) => outcome.map_err(|e| RpcError::ToolError(e.to_string())),
        Err(e) => Err(RpcError::Internal(format!("pcap capture task failed: {e}"))),
    }
}

/// Cancels a capture when the future running it is dropped.
#[cfg(feature = "pcap")]
struct StopOnDrop(netscli_core::PcapCancelToken);

#[cfg(feature = "pcap")]
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

/// Remove an output file nothing was written to, so a capture that could
/// not start (no capture rights, no such interface) leaves nothing behind,
/// as it did before the file was created up front.
#[cfg(feature = "pcap")]
fn remove_if_empty(name: &str) {
    let empty = std::fs::symlink_metadata(name).is_ok_and(|m| m.is_file() && m.len() == 0);
    if empty {
        let _ = std::fs::remove_file(name);
    }
}

#[cfg(feature = "pcap")]
pub(in crate::server) async fn op_capture_pcap(
    p: PcapParams,
) -> Result<netscli_core::PcapResult, RpcError> {
    let mut request = interactive_request(p)?;
    request.claim_output_file(unnamed_capture())?;
    run_pcap_capture(request, netscli_core::PcapCancelToken::new()).await
}

/// The blocking tool's request: a duration always set, and never past the
/// interactive clamp. With only `maxPackets` it used to fall through to
/// core's one-hour ceiling. It now gets the default the tool advertises.
#[cfg(feature = "pcap")]
fn interactive_request(p: PcapParams) -> Result<PcapCaptureRequest, RpcError> {
    let mut request = validate_pcap_capture_params(p)?;
    request
        .duration
        .get_or_insert(netscli_core::DEFAULT_PCAP_CAPTURE_SECONDS);
    Ok(request)
}

#[cfg(feature = "pcap")]
fn validate_mcp_pcap_output_file(output_file: String) -> Result<String, RpcError> {
    let path = std::path::PathBuf::from(output_file.trim());
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| RpcError::InvalidParams("outputFile must include a filename".to_string()))?;
    if path.components().count() != 1 {
        return Err(RpcError::InvalidParams(
            "outputFile for MCP packet capture must be a filename, not a path".to_string(),
        ));
    }
    if !filename.to_ascii_lowercase().ends_with(".pcap") {
        return Err(RpcError::InvalidParams(
            "outputFile must end in .pcap".to_string(),
        ));
    }
    Ok(filename.to_string())
}

#[cfg(not(feature = "pcap"))]
pub(in crate::server) async fn op_capture_pcap(
    _p: PcapParams,
) -> Result<netscli_core::PcapResult, RpcError> {
    Err(RpcError::ToolError(
        "pcap support disabled at compile time".to_string(),
    ))
}

#[cfg(all(test, feature = "pcap"))]
mod tests;
