//! The MCP `tools/call` handler.
//!
//! Split out of `dispatch.rs`, which was at the 300-line guard. It is a
//! real seam rather than a convenient cut: everything here is about the MCP
//! tool-call envelope -- unwrapping `arguments`, routing the stateful pcap
//! job tools, and deciding whether a failure is a tool result or a protocol
//! fault. `dispatch.rs` keeps the JSON-RPC method routing.

use serde::Deserialize;
use serde_json::Value;

use super::super::errors::RpcError;
use super::super::schemas::parse_params;
use super::super::tools::{mcp_tool_error_text, mcp_tool_result_text};
use super::{dispatch_tool, SharedState};

#[cfg(feature = "pcap")]
use super::super::jobs::{pcap_job_result, pcap_job_status, start_pcap_capture_job};
#[cfg(feature = "pcap")]
use super::lock;

pub(super) async fn handle_tools_call(
    state: &SharedState,
    params: Value,
) -> Result<serde_json::Value, RpcError> {
    #[cfg(not(feature = "pcap"))]
    let _ = state;

    #[derive(Deserialize)]
    struct ToolCallParams {
        name: String,
        #[serde(default, rename = "arguments")]
        args: serde_json::Value,
    }

    let p: ToolCallParams = parse_params(params)?;
    let args = if p.args.is_null() {
        Value::Object(serde_json::Map::new())
    } else {
        p.args
    };

    #[cfg(feature = "pcap")]
    {
        match p.name.as_str() {
            "start_pcap_capture" => {
                let mut guard = lock(state)?;
                return Ok(mcp_tool_result_text(start_pcap_capture_job(
                    &mut guard, args,
                )?));
            }
            "get_pcap_capture_status" => {
                let guard = lock(state)?;
                return Ok(mcp_tool_result_text(pcap_job_status(&guard, args)?));
            }
            "get_pcap_capture_result" => {
                let guard = lock(state)?;
                return Ok(mcp_tool_result_text(pcap_job_result(&guard, args)?));
            }
            _ => {}
        }
    }

    match dispatch_tool(&p.name, args).await {
        Ok(output) => Ok(mcp_tool_result_text(output)),
        // A tool that ran and failed is a *result*, not a protocol fault.
        // Returning -32000 here made "host unreachable" look to the client
        // like a broken server, and the model never saw the message it needed
        // in order to try something else. Framing problems keep their codes.
        Err(RpcError::ToolError(message)) => Ok(mcp_tool_error_text(&message)),
        Err(RpcError::MethodNotFound) => {
            Err(RpcError::InvalidParams(format!("Unknown tool: {}", p.name)))
        }
        Err(other) => Err(other),
    }
}
