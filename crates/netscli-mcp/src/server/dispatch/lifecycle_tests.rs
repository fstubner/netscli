//! `ping` and protocol version negotiation.
//!
//! Separate from `tests.rs`, which covers the rest of the lifecycle and is at
//! the size guard.

use serde_json::json;

use super::*;
use crate::server::protocol::JsonRpcRequest;

fn request(method: &str, params: Option<Value>) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
        id: Some(Some(json!(1))),
    }
}

fn new_state() -> SharedState {
    Arc::new(Mutex::new(ServerState::default()))
}

async fn negotiated(requested: Value) -> Value {
    let params = json!({ "protocolVersion": requested, "capabilities": {} });
    let resp = handle_request(new_state(), request("initialize", Some(params))).await;
    resp.result.expect("initialize must succeed")["protocolVersion"].clone()
}

#[tokio::test]
async fn ping_is_answered_with_an_empty_result_even_before_initialize() {
    let resp = handle_request(new_state(), request("ping", None)).await;
    assert!(resp.error.is_none(), "ping failed: {:?}", resp.error);
    assert_eq!(resp.result, Some(json!({})));
}

#[tokio::test]
async fn only_a_version_this_server_implements_is_agreed_as_asked() {
    for version in SUPPORTED_PROTOCOL_VERSIONS {
        assert_eq!(negotiated(json!(version)).await, json!(version));
    }
    // The client's version was echoed whatever it was, so this server
    // claimed to speak versions it has never seen.
    for version in ["2099-01-01", "1.0", ""] {
        assert_eq!(
            negotiated(json!(version)).await,
            json!(SUPPORTED_PROTOCOL_VERSIONS[0]),
            "asked for {version:?}"
        );
    }
}
