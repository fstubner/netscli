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
    pub(in crate::server) fn ensure_default_output_file(&mut self, output_file: String) {
        if self.output_file.is_none() {
            self.output_file = Some(output_file);
        }
    }
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

#[cfg(feature = "pcap")]
pub(in crate::server) async fn run_pcap_capture(
    request: PcapCaptureRequest,
) -> Result<netscli_core::PcapResult, RpcError> {
    // `try_acquire`, not `acquire`: waiting would hold one of the server's
    // request permits for however long the running captures take, which is
    // the wedge this limit exists to prevent. Refusing immediately tells the
    // client something actionable instead.
    let _slot = PCAP_CAPTURE_SLOTS.try_acquire().map_err(|_| {
        RpcError::ToolError(format!(
            "too many packet captures are already running (max {MAX_CONCURRENT_PCAP_CAPTURES})"
        ))
    })?;
    let ops = netscli_core::Ops::default();
    ops.capture_pcap_async(
        request.interface,
        request.filter,
        request.duration,
        request.output_file,
        request.max_packets,
    )
    .await
    .map_err(|e| RpcError::ToolError(e.to_string()))
}

#[cfg(feature = "pcap")]
pub(in crate::server) async fn op_capture_pcap(
    p: PcapParams,
) -> Result<netscli_core::PcapResult, RpcError> {
    let request = validate_pcap_capture_params(p)?;
    run_pcap_capture(request).await
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
