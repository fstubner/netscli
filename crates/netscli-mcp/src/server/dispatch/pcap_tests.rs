//! The packet-capture job tools over `tools/call`.
//!
//! Moved out of `tests.rs`, which is at the size guard, when the lifecycle
//! test had to wait for its job to end.

use std::time::Duration;

use serde_json::json;

use super::*;
use crate::server::protocol::JsonRpcRequest;

fn request(method: &str, params: Option<Value>, id: i64) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
        id: Some(Some(json!(id))),
    }
}

async fn initialized_state() -> SharedState {
    let state: SharedState = Arc::new(Mutex::new(ServerState::default()));
    let resp = handle_request(state.clone(), request("initialize", Some(json!({})), 0)).await;
    assert!(resp.error.is_none(), "initialize failed: {:?}", resp.error);
    state
}

async fn call(state: &SharedState, tool: &str, arguments: Value) -> JsonRpcResponse {
    let params = json!({ "name": tool, "arguments": arguments });
    handle_request(state.clone(), request("tools/call", Some(params), 1)).await
}

/// The JSON a tool returned as its text content.
fn tool_output(resp: &JsonRpcResponse) -> Option<Value> {
    let result = resp.result.as_ref()?;
    let text = result.get("content")?.get(0)?.get("text")?.as_str()?;
    serde_json::from_str(text).ok()
}

#[tokio::test]
async fn pcap_job_lifecycle_start_status_result() {
    let state = initialized_state().await;

    let start = call(
        &state,
        "start_pcap_capture",
        json!({"interface": "netscli-test0"}),
    )
    .await;
    assert!(start.error.is_none(), "start failed: {:?}", start.error);
    let started = tool_output(&start).expect("start returns the job's status");
    let job_id = started["jobId"].as_str().expect("a jobId").to_string();
    // Named, and created, before the capture runs, so the client knows where
    // the capture goes without waiting for the result.
    let output_file = started["outputFile"].as_str().expect("an outputFile");

    // There is no interface netscli-test0, so the job fails at once. Wait for
    // that, so the file made for it is gone before the test ends.
    let mut status = Value::Null;
    for _ in 0..100 {
        let resp = call(&state, "get_pcap_capture_status", json!({"jobId": job_id})).await;
        assert!(resp.error.is_none(), "status failed: {:?}", resp.error);
        status = tool_output(&resp).expect("a status");
        if status["running"] == false {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(status["status"], "failed", "{status}");
    assert!(
        !std::path::Path::new(output_file).exists(),
        "the empty file made for the job must go"
    );

    let result = call(&state, "get_pcap_capture_result", json!({"jobId": job_id})).await;
    assert!(result.error.is_none(), "result failed: {:?}", result.error);
}

#[tokio::test]
async fn pcap_job_status_rejects_unknown_job_id() {
    let state = initialized_state().await;
    let resp = call(
        &state,
        "get_pcap_capture_status",
        json!({"jobId": "pcap-does-not-exist"}),
    )
    .await;
    let err = resp.error.expect("expected unknown-jobId error");
    assert_eq!(err.code, -32602);
}
