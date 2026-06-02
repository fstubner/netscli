use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub(super) struct JsonRpcRequest {
    pub(super) jsonrpc: String,
    pub(super) method: String,
    pub(super) params: Option<serde_json::Value>,
    pub(super) id: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug)]
pub(super) struct JsonRpcResponse {
    pub(super) jsonrpc: String,
    pub(super) result: Option<serde_json::Value>,
    pub(super) error: Option<JsonRpcError>,
    pub(super) id: Option<serde_json::Value>,
}

impl JsonRpcResponse {
    pub(super) fn parse_error() -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32700,
                message: "Parse error".to_string(),
            }),
            id: Some(serde_json::Value::Null),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub(super) struct JsonRpcError {
    pub(super) code: i32,
    pub(super) message: String,
}
