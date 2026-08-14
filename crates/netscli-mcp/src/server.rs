mod dispatch;
mod errors;
#[cfg(feature = "pcap")]
mod jobs;
mod operations;
mod protocol;
mod schemas;
mod tools;

use std::sync::{Arc, Mutex};

use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::{mpsc, Semaphore};

use dispatch::{handle_request, ServerState};
use protocol::{JsonRpcRequest, JsonRpcResponse};

/// Ceiling on requests executing at once.
///
/// Each in-flight request can itself fan out to `Ops`-level concurrency
/// (which clamps to 1024 sockets), so this bounds how many of those fans a
/// misbehaving or enthusiastic client can stack up. Requests beyond the
/// limit queue rather than being rejected — ordering of *responses* is not
/// guaranteed by JSON-RPC, but every request still gets answered.
const MAX_CONCURRENT_REQUESTS: usize = 16;

pub use tools::tools_list;

/// Initialize a tracing subscriber that writes JSON to stderr.
///
/// Uses `RUST_LOG` if set, otherwise defaults to `info`. Uses `try_init`
/// so it's a no-op when the caller already installed a subscriber (e.g.
/// a host binary that wants its own format).
///
/// **Why stderr, not stdout?** stdout is the JSON-RPC transport — any
/// byte written there that isn't a valid response will break the client.
fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(filter)
        .with_target(false)
        .json()
        .with_current_span(false)
        .with_span_list(false)
        .try_init();
}

pub async fn run_server() -> anyhow::Result<()> {
    init_tracing();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        pcap = cfg!(feature = "pcap"),
        "netscli MCP server starting"
    );

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin).lines();
    let state = Arc::new(Mutex::new(ServerState::default()));
    let limiter = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));

    // Responses are funnelled through one channel to a single writer task.
    // Two concurrent handlers must never interleave bytes on stdout, and a
    // dedicated writer is simpler to reason about than sharing a locked
    // writer between tasks.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer_task = tokio::spawn(async move {
        let mut writer = BufWriter::new(stdout);
        let mut written: u64 = 0;
        while let Some(line) = rx.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err()
                || writer.write_all(b"\n").await.is_err()
                || writer.flush().await.is_err()
            {
                // stdout is gone (client detached); nothing useful is left
                // to do on this transport.
                break;
            }
            written += 1;
        }
        written
    });

    // Serialising here rather than in each handler keeps the error path off
    // the spawned tasks, which have no way to propagate a `?`.
    let send = |tx: &mpsc::UnboundedSender<String>, response: &JsonRpcResponse| {
        match serde_json::to_string(response) {
            Ok(s) => {
                let _ = tx.send(s);
            }
            Err(e) => tracing::error!(error = %e, "failed to serialize response"),
        }
    };

    while let Some(line) = reader.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(req) => req,
            Err(e) => {
                tracing::warn!(error = %e, "json parse error");
                send(&tx, &JsonRpcResponse::parse_error());
                continue;
            }
        };

        // A *missing* id makes this a notification, which must not get a
        // response. An explicit `"id": null` is a request and is handled
        // below like any other.
        if request.id.is_none() {
            tracing::debug!(method = %request.method, "notification");
            if request.method == "notifications/initialized" {
                if let Ok(mut guard) = state.lock() {
                    guard.initialized = true;
                }
            }
            continue;
        }

        // Read the next line immediately instead of awaiting the handler.
        // This is the whole point: a slow `sweep_network` no longer blocks
        // the requests queued behind it, including its own cancellation.
        let state = Arc::clone(&state);
        let limiter = Arc::clone(&limiter);
        let tx = tx.clone();
        tokio::spawn(async move {
            // `acquire_owned` on an Arc'd semaphore that is never closed
            // only fails if the semaphore is closed, so this cannot error
            // in practice; drop the permit-holding task if it ever does.
            let Ok(_permit) = limiter.acquire_owned().await else {
                return;
            };
            let response = handle_request(state, request).await;
            match serde_json::to_string(&response) {
                Ok(s) => {
                    let _ = tx.send(s);
                }
                Err(e) => tracing::error!(error = %e, "failed to serialize response"),
            }
        });
    }

    // Dropping the last sender ends the writer loop; the clones held by
    // still-running handlers keep it alive until they finish.
    drop(tx);
    let requests_handled = writer_task.await.unwrap_or(0);

    tracing::info!(requests_handled, "netscli MCP server shutting down");
    Ok(())
}
