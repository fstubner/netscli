//! The read loop in `serve`, driven over in-memory pipes.
//!
//! The handler stands in for `handle_request` so a request can be made to
//! never finish, which is the only way to hold every slot without a network.

use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines};
use tokio::task::JoinHandle;

use super::*;

/// `hang` never answers. Anything else is answered at once.
async fn handler(_state: SharedState, request: JsonRpcRequest) -> JsonRpcResponse {
    if request.method == "hang" {
        std::future::pending::<()>().await;
    }
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: Some(json!({ "method": request.method })),
        error: None,
        id: request.id.flatten(),
    }
}

type Replies = Lines<BufReader<DuplexStream>>;

fn start() -> (DuplexStream, Replies, JoinHandle<anyhow::Result<()>>) {
    let (to_server, server_input) = tokio::io::duplex(1 << 16);
    let (server_output, from_server) = tokio::io::duplex(1 << 16);
    let server = tokio::spawn(serve(server_input, server_output, handler));
    (to_server, BufReader::new(from_server).lines(), server)
}

async fn send(input: &mut DuplexStream, message: Value) {
    input
        .write_all(format!("{message}\n").as_bytes())
        .await
        .unwrap();
}

async fn request(input: &mut DuplexStream, id: Value, method: &str) {
    send(input, json!({"jsonrpc": "2.0", "id": id, "method": method})).await;
}

async fn next_reply(replies: &mut Replies) -> Value {
    let line = tokio::time::timeout(Duration::from_secs(5), replies.next_line())
        .await
        .expect("a reply within 5 s")
        .unwrap()
        .expect("the server's output is still open");
    serde_json::from_str(&line).unwrap()
}

// With every slot busy the loop used to wait for one before reading another
// line, so this cancel was never read, and cancelling is how a client frees
// a slot.
#[tokio::test]
async fn a_cancel_is_read_while_every_slot_is_busy() {
    let (mut input, mut replies, _server) = start();
    for id in 1..=MAX_CONCURRENT_REQUESTS {
        request(&mut input, json!(id), "hang").await;
    }
    request(&mut input, json!("queued"), "echo").await;
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 1}}),
    )
    .await;

    let reply = next_reply(&mut replies).await;
    assert_eq!(reply["id"], "queued", "{reply}");
    assert_eq!(reply["result"]["method"], "echo");
}

// EOF went unread the same way, so a client that closed stdin left the
// server running with every request still holding its slot.
#[tokio::test]
async fn eof_is_read_while_every_slot_is_busy() {
    let (mut input, _replies, server) = start();
    for id in 1..=MAX_CONCURRENT_REQUESTS + 1 {
        request(&mut input, json!(id), "hang").await;
    }
    drop(input);

    let ended = tokio::time::timeout(Duration::from_secs(5), server).await;
    ended
        .expect("serve must return once stdin closes")
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn a_request_past_the_held_limit_is_refused_at_once() {
    let (mut input, mut replies, _server) = start();
    for id in 1..=MAX_HELD_REQUESTS {
        request(&mut input, json!(id), "hang").await;
    }
    request(&mut input, json!("one too many"), "echo").await;

    let reply = next_reply(&mut replies).await;
    assert_eq!(reply["id"], "one too many", "{reply}");
    assert_eq!(reply["error"]["code"], -32000);
    assert!(reply.get("result").is_none(), "{reply}");
}
