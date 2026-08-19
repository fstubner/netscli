//! Behaviour of the tool surface: target policy, error shape, param
//! tolerance.
//!
//! Separate from `tests.rs`, which covers protocol lifecycle. That file was
//! at the 300-line guard and these are a distinct family.

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

// The MCP surface is the one an untrusted party -- a model reading a web
// page -- can steer. These pin the boundaries that makes safe.

#[tokio::test]
async fn a_public_subnet_is_refused_without_the_opt_in() {
    // Size was the only thing checked, and a /16 of someone else's address
    // space is still a /16.
    //
    // TEST-NET-2 (RFC 5737) rather than a real public range: it is not
    // local, so the policy refuses it, and it is not routed to anyone, so
    // breaking the policy turns this into a no-op instead of a live scan of
    // a stranger's network.
    let state = initialized_state().await;
    let res = handle_request(
        state,
        request(
            "tools/call",
            Some(
                json!({ "name": "discover_network", "arguments": { "subnet": "198.51.100.0/24" } }),
            ),
            1,
        ),
    )
    .await;
    let text = serde_json::to_string(&res).unwrap();
    assert!(
        text.contains("outside the local network"),
        "expected a scope refusal, got: {text}"
    );
}

#[tokio::test]
async fn a_local_subnet_is_still_accepted() {
    let state = initialized_state().await;
    let res = handle_request(
        state,
        request(
            "tools/call",
            Some(json!({ "name": "discover_network", "arguments": { "subnet": "192.168.250.0/30" } })),
            2,
        ),
    )
    .await;
    let text = serde_json::to_string(&res).unwrap();
    assert!(
        !text.contains("outside the local network"),
        "a local subnet must not be refused: {text}"
    );
}

#[tokio::test]
async fn a_failed_tool_is_a_result_not_a_protocol_error() {
    // "host unreachable" used to arrive as -32000, which reads to a client
    // as a broken server rather than a scan that did not work.
    let state = initialized_state().await;
    let res = handle_request(
        state,
        request(
            "tools/call",
            Some(json!({ "name": "dns_lookup", "arguments": { "host": "no-such-host.invalid" } })),
            3,
        ),
    )
    .await;
    assert!(
        res.error.is_none(),
        "tool failure must not be a JSON-RPC error"
    );
    let result = res.result.expect("a result payload");
    assert_eq!(result["isError"], true);
}

#[tokio::test]
async fn a_legacy_method_with_no_params_is_accepted() {
    // `tools/call` mapped absent arguments to `{}`; the direct methods did
    // not, so the same call succeeded one way and returned -32602 the other.
    let state = initialized_state().await;
    let mut req = request("list_network_interfaces", None, 4);
    req.params = None;
    let res = handle_request(state, req).await;
    assert!(
        res.error.is_none(),
        "absent params must not be an error: {:?}",
        res.error
    );
}
