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
    // Exactly one of `result` and `error` goes on the wire. JSON-RPC 2.0 says
    // the other member MUST NOT exist, and the official MCP TypeScript SDK
    // holds replies to that: one carrying `"error": null` beside its result
    // was dropped as invalid, so a client built on the SDK never received the
    // `initialize` answer and timed out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<JsonRpcError>,
    // Never skipped. A reply to a request whose id was null, or could not be
    // read, must still say `"id": null`.
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

    /// A request that hit the server's overall time ceiling.
    ///
    /// Carries the original id: the client is still waiting on that id, and
    /// answering it is the difference between a slow tool and a server that
    /// silently never replies.
    pub(super) fn request_timeout(id: Option<serde_json::Value>, seconds: u64) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                // -32000 is the server-defined range; this is a server
                // condition rather than a malformed request.
                code: -32000,
                message: format!("request exceeded the maximum duration of {seconds}s"),
            }),
            id,
        }
    }

    /// A request that arrived with `held` requests already running or
    /// waiting for a slot.
    pub(super) fn server_busy(id: Option<serde_json::Value>, held: usize) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32000,
                message: format!(
                    "server busy: {held} requests are already running or waiting. Retry when one has been answered."
                ),
            }),
            id,
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub(super) struct JsonRpcError {
    pub(super) code: i32,
    pub(super) message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    // JSON-RPC 2.0 allows exactly one of `result` and `error` in a reply.
    // Every reply used to carry both, one of them null, and the official MCP
    // TypeScript SDK drops such a reply as invalid: clients built on it never
    // received the `initialize` answer and timed out.
    #[test]
    fn a_reply_carries_result_or_error_never_both() {
        let ok = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(json!({})),
            error: None,
            id: Some(json!(1)),
        };
        let ok = serde_json::to_value(ok).unwrap();
        assert_eq!(ok, json!({"jsonrpc": "2.0", "result": {}, "id": 1}));

        let failed = JsonRpcResponse::request_timeout(Some(json!(2)), 900);
        let failed = serde_json::to_value(failed).unwrap();
        assert!(failed.get("result").is_none(), "{failed}");
        assert_eq!(failed["error"]["code"], -32000);
    }

    // The id is the one member that stays when it is null. A reply to a
    // request whose id could not be read, or was itself null, must still say
    // `"id": null`.
    #[test]
    fn an_unknown_id_is_still_written_as_null() {
        let reply = serde_json::to_value(JsonRpcResponse::parse_error()).unwrap();
        assert_eq!(
            reply,
            json!({"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": null})
        );

        let reply = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(json!({})),
            error: None,
            id: None,
        };
        let reply = serde_json::to_value(reply).unwrap();
        assert_eq!(reply.get("id"), Some(&Value::Null), "{reply}");
    }
}
