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

fn new_state() -> SharedState {
    Arc::new(Mutex::new(ServerState::default()))
}

async fn initialized_state() -> SharedState {
    let state = new_state();
    let resp = handle_request(state.clone(), request("initialize", Some(json!({})), 0)).await;
    assert!(resp.error.is_none(), "initialize failed: {:?}", resp.error);
    state
}

#[tokio::test]
async fn methods_before_initialize_are_rejected() {
    let state = new_state();
    let resp = handle_request(
        state.clone(),
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
    let state = new_state();
    let resp = handle_request(state.clone(), request("tools/list", None, 1)).await;
    assert!(resp.error.is_none(), "tools/list failed: {:?}", resp.error);

    let resp = handle_request(state.clone(), request("initialize", Some(json!({})), 2)).await;
    assert!(resp.error.is_none(), "initialize failed: {:?}", resp.error);
}

#[tokio::test]
async fn invalid_params_return_invalid_params_code() {
    let state = initialized_state().await;
    // scan_ports requires "host"; omit it to trigger a deserialize failure.
    let resp = handle_request(
        state.clone(),
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
    let state = initialized_state().await;
    let resp = handle_request(
        state.clone(),
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
    let state = initialized_state().await;
    let resp = handle_request(state.clone(), request("does_not_exist", None, 5)).await;
    let err = resp.error.expect("expected method-not-found error");
    assert_eq!(err.code, -32601);
}

#[tokio::test]
async fn oversized_subnet_is_rejected() {
    let state = initialized_state().await;
    let resp = handle_request(
        state.clone(),
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
    let state = initialized_state().await;
    let ports: Vec<u16> = (1u16..=(netscli_core::MAX_PORTS_PER_SCAN as u16 + 1)).collect();
    let resp = handle_request(
        state.clone(),
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

// A-01 regression. Before this, `run_server` awaited each handler inline, so
// a slow tool call held up every request behind it — measured at 9.3 s for a
// `tools/list` queued behind one `ping_host`.
//
// Asserting on wall-clock would be flaky on a loaded CI box, so instead this
// pins the property that made the fix possible: the handler future is `Send`
// and `'static`, which is exactly what lets `run_server` spawn it instead of
// awaiting it. A regression to `&mut ServerState` fails to compile here.
#[tokio::test]
async fn handlers_can_run_concurrently_on_shared_state() {
    let state = initialized_state().await;

    let handles: Vec<_> = (0..8)
        .map(|i| {
            let state = state.clone();
            tokio::spawn(async move { handle_request(state, request("tools/list", None, i)).await })
        })
        .collect();

    for handle in handles {
        let resp = handle.await.expect("handler task panicked");
        assert!(resp.error.is_none(), "tools/list failed: {:?}", resp.error);
    }
}

// C-09 regression: an explicit `"id": null` is a *request* under JSON-RPC 2.0
// and must be answered. It was previously indistinguishable from an absent id
// and silently dropped, leaving the caller waiting forever.
#[tokio::test]
async fn explicit_null_id_is_answered() {
    let state = initialized_state().await;
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/list".to_string(),
        params: None,
        id: Some(Some(Value::Null)),
    };
    assert!(req.id.is_some(), "explicit null id must not read as absent");

    let resp = handle_request(state, req).await;
    assert!(resp.error.is_none(), "tools/list failed: {:?}", resp.error);
    assert_eq!(resp.id, Some(Value::Null), "response must echo the null id");
}

// A missing `jsonrpc` field is an Invalid Request (-32600), not a Parse Error
// (-32700) — the message is well-formed JSON, it just isn't valid JSON-RPC.
#[tokio::test]
async fn missing_jsonrpc_version_is_invalid_request() {
    let state = initialized_state().await;
    let req: JsonRpcRequest =
        serde_json::from_str(r#"{"method":"tools/list","id":1}"#).expect("should still parse");
    let resp = handle_request(state, req).await;
    let err = resp.error.expect("expected invalid-request error");
    assert_eq!(err.code, -32600);
}

// The pcap job tools only exist in `--features pcap` builds; verify they're
// unreachable (not a silent no-op) when the feature is off, since they share
// `dispatch_tool`'s catch-all with every other unknown tool name.
#[cfg(not(feature = "pcap"))]
#[tokio::test]
async fn pcap_job_tools_are_unknown_without_pcap_feature() {
    let state = initialized_state().await;
    for tool in [
        "start_pcap_capture",
        "get_pcap_capture_status",
        "get_pcap_capture_result",
    ] {
        let resp = handle_request(
            state.clone(),
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
    let state = initialized_state().await;

    let start = handle_request(
        state.clone(),
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
        state.clone(),
        request(
            "tools/call",
            Some(json!({"name": "get_pcap_capture_status", "arguments": {"jobId": job_id}})),
            10,
        ),
    )
    .await;
    assert!(status.error.is_none(), "status failed: {:?}", status.error);

    let result = handle_request(
        state.clone(),
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
    let state = initialized_state().await;
    let resp = handle_request(
        state.clone(),
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
