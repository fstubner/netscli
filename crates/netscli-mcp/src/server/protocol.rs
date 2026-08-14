use serde::{Deserialize, Deserializer, Serialize};

/// Distinguish "field absent" from "field present and null".
///
/// JSON-RPC 2.0 treats these differently: an absent `id` makes the message a
/// *notification* (no response may be sent), whereas an explicit `"id": null`
/// is a *request* that must be answered with `"id": null`. A plain
/// `Option<Value>` collapses both into `None`, so `{"id": null}` was silently
/// dropped and the caller waited forever.
fn double_option<'de, D>(de: D) -> Result<Option<Option<serde_json::Value>>, D::Error>
where
    D: Deserializer<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}

#[derive(Serialize, Deserialize, Debug)]
pub(super) struct JsonRpcRequest {
    // Defaulted rather than required so that a message missing `jsonrpc`
    // still parses and reaches the explicit version check, which reports
    // -32600 Invalid Request. Making it mandatory here meant serde failed
    // first and the caller got -32700 Parse Error instead.
    #[serde(default)]
    pub(super) jsonrpc: String,
    pub(super) method: String,
    pub(super) params: Option<serde_json::Value>,
    #[serde(default, deserialize_with = "double_option")]
    pub(super) id: Option<Option<serde_json::Value>>,
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
