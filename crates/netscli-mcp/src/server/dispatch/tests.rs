use serde_json::json;

use super::*;
use crate::server::protocol::JsonRpcRequest;

fn request(method: &str, params: Option<Value>, id: i64) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
        id: Some(json!(id)),
    }
}

async fn initialized_state() -> ServerState {
    let mut state = ServerState::default();
    let resp = handle_request(&mut state, request("initialize", Some(json!({})), 0)).await;
    assert!(resp.error.is_none(), "initialize failed: {:?}", resp.error);
    state
}

#[tokio::test]
async fn methods_before_initialize_are_rejected() {
    let mut state = ServerState::default();
    let resp = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "list_network_interfaces", "arguments": {}})),
            1,
        ),
    )
    .await;
    let err = resp.error.expect("expected NotInitialized error");
    assert_eq!(err.code, -32002);
}

#[tokio::test]
async fn tools_list_and_initialize_are_allowed_before_initialize() {
    let mut state = ServerState::default();
    let resp = handle_request(&mut state, request("tools/list", None, 1)).await;
    assert!(resp.error.is_none(), "tools/list failed: {:?}", resp.error);

    let resp = handle_request(&mut state, request("initialize", Some(json!({})), 2)).await;
    assert!(resp.error.is_none(), "initialize failed: {:?}", resp.error);
}

#[tokio::test]
async fn invalid_params_return_invalid_params_code() {
    let mut state = initialized_state().await;
    // scan_ports requires "host"; omit it to trigger a deserialize failure.
    let resp = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "scan_ports", "arguments": {}})),
            3,
        ),
    )
    .await;
    let err = resp.error.expect("expected invalid params error");
    assert_eq!(err.code, -32602);
}

#[tokio::test]
async fn unknown_tool_name_is_invalid_params() {
    let mut state = initialized_state().await;
    let resp = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "does_not_exist", "arguments": {}})),
            4,
        ),
    )
    .await;
    let err = resp.error.expect("expected error for unknown tool");
    assert_eq!(err.code, -32602);
    assert!(
        err.message.contains("Unknown tool: does_not_exist"),
        "message: {}",
        err.message
    );
}

#[tokio::test]
async fn unknown_method_is_method_not_found() {
    let mut state = initialized_state().await;
    let resp = handle_request(&mut state, request("does_not_exist", None, 5)).await;
    let err = resp.error.expect("expected method-not-found error");
    assert_eq!(err.code, -32601);
}

#[tokio::test]
async fn oversized_subnet_is_rejected() {
    let mut state = initialized_state().await;
    let resp = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "discover_network", "arguments": {"subnet": "10.0.0.0/8"}})),
            6,
        ),
    )
    .await;
    let err = resp.error.expect("expected subnet-too-large error");
    assert_eq!(err.code, -32602);
    assert!(
        err.message.contains("too large"),
        "message: {}",
        err.message
    );
}

#[tokio::test]
async fn too_many_ports_is_rejected() {
    let mut state = initialized_state().await;
    let ports: Vec<u16> = (1u16..=(netscli_core::MAX_PORTS_PER_SCAN as u16 + 1)).collect();
    let resp = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "scan_ports", "arguments": {"host": "127.0.0.1", "ports": ports}})),
            7,
        ),
    )
    .await;
    let err = resp.error.expect("expected too-many-ports error");
    assert_eq!(err.code, -32602);
    assert!(
        err.message.contains("too many ports"),
        "message: {}",
        err.message
    );
}

// The pcap job tools only exist in `--features pcap` builds; verify they're
// unreachable (not a silent no-op) when the feature is off, since they share
// `dispatch_tool`'s catch-all with every other unknown tool name.
#[cfg(not(feature = "pcap"))]
#[tokio::test]
async fn pcap_job_tools_are_unknown_without_pcap_feature() {
    let mut state = initialized_state().await;
    for tool in [
        "start_pcap_capture",
        "get_pcap_capture_status",
        "get_pcap_capture_result",
    ] {
        let resp = handle_request(
            &mut state,
            request(
                "tools/call",
                Some(json!({"name": tool, "arguments": {}})),
                8,
            ),
        )
        .await;
        let err = resp
            .error
            .unwrap_or_else(|| panic!("expected error for {tool}"));
        assert_eq!(err.code, -32602);
    }
}

#[cfg(feature = "pcap")]
#[tokio::test]
async fn pcap_job_lifecycle_start_status_result() {
    let mut state = initialized_state().await;

    let start = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(
                json!({"name": "start_pcap_capture", "arguments": {"interface": "netscli-test0"}}),
            ),
            9,
        ),
    )
    .await;
    assert!(start.error.is_none(), "start failed: {:?}", start.error);
    let job_id = extract_job_id(&start).expect("start response should include a jobId");

    let status = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "get_pcap_capture_status", "arguments": {"jobId": job_id}})),
            10,
        ),
    )
    .await;
    assert!(status.error.is_none(), "status failed: {:?}", status.error);

    let result = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "get_pcap_capture_result", "arguments": {"jobId": job_id}})),
            11,
        ),
    )
    .await;
    assert!(result.error.is_none(), "result failed: {:?}", result.error);
}

#[cfg(feature = "pcap")]
#[tokio::test]
async fn pcap_job_status_rejects_unknown_job_id() {
    let mut state = initialized_state().await;
    let resp = handle_request(
        &mut state,
        request(
            "tools/call",
            Some(json!({"name": "get_pcap_capture_status", "arguments": {"jobId": "pcap-does-not-exist"}})),
            12,
        ),
    )
    .await;
    let err = resp.error.expect("expected unknown-jobId error");
    assert_eq!(err.code, -32602);
}

#[cfg(feature = "pcap")]
fn extract_job_id(resp: &JsonRpcResponse) -> Option<String> {
    let result = resp.result.as_ref()?;
    let text = result.get("content")?.get(0)?.get("text")?.as_str()?;
    let parsed: Value = serde_json::from_str(text).ok()?;
    parsed
        .get("jobId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
