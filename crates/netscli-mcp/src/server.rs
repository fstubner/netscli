mod dispatch;
mod errors;
mod inflight;
#[cfg(feature = "pcap")]
mod jobs;
mod limits;
mod lines;
mod operations;
mod progress;
mod protocol;
mod schemas;
mod targets;
mod tools;

use std::future::Future;
use std::sync::{Arc, Mutex};

use tokio::io::{self, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::{mpsc, Semaphore};
use tokio::task::JoinSet;

use dispatch::{handle_request, ServerState, SharedState};
use lines::{read_bounded_line, LineError};
use protocol::{JsonRpcRequest, JsonRpcResponse};

/// Ceiling on requests executing at once.
///
/// Each in-flight request can itself fan out to `Ops`-level concurrency
/// (which clamps to 1024 sockets), so this bounds how many of those fans a
/// misbehaving or enthusiastic client can stack up. Requests beyond the
/// limit wait for a slot rather than being rejected, up to
/// `MAX_HELD_REQUESTS`.
const MAX_CONCURRENT_REQUESTS: usize = 16;

/// Most requests held at once, running or waiting for a slot.
///
/// The read loop used to wait for a free slot itself, so with all sixteen
/// busy nothing more was read from stdin: not `notifications/cancelled`,
/// which is how a client frees a slot, and not EOF. Cancelling failed exactly
/// when the server was busiest. A request that finds every slot taken now
/// waits in its own task, where a cancel can reach it, and the loop goes back
/// to reading. This bound replaces the backpressure that waiting gave: past
/// it, a request is answered with an error at once rather than kept in memory
/// with its params.
const MAX_HELD_REQUESTS: usize = 2 * MAX_CONCURRENT_REQUESTS;

/// Longest any single request may run before it is abandoned.
///
/// The per-probe timeouts are bounded, but nothing bounded probes multiplied
/// by timeout: `ping_host` with `count=256` at the 10-minute per-probe
/// ceiling is roughly 42 hours, and it holds one of the permits above for
/// all of it. Sixteen such calls wedged the server with no way back.
const MAX_REQUEST_DURATION: std::time::Duration = std::time::Duration::from_secs(15 * 60);

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
    serve(io::stdin(), io::stdout(), handle_request).await
}

/// The JSON-RPC loop over any transport.
///
/// `handle` answers one request. It is a parameter so the tests can drive
/// the loop itself, with requests that never finish, to pin what happens
/// when every slot is busy. `run_server` passes `handle_request`.
async fn serve<R, W, H, F>(input: R, output: W, handle: H) -> anyhow::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
    H: Fn(SharedState, JsonRpcRequest) -> F,
    F: Future<Output = JsonRpcResponse> + Send + 'static,
{
    // `read_bounded_line` caps each line; `lines()` on its own grows without
    // limit.
    let mut reader = BufReader::new(input);
    let state = Arc::new(Mutex::new(ServerState::default()));
    let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
    let held = Arc::new(Semaphore::new(MAX_HELD_REQUESTS));
    let inflight = Arc::new(inflight::InFlight::default());

    // Responses are funnelled through one channel to a single writer task.
    // Two concurrent handlers must never interleave bytes on stdout, and a
    // dedicated writer is simpler to reason about than sharing a locked
    // writer between tasks.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer_task = tokio::spawn(async move {
        let mut writer = BufWriter::new(output);
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

    // Handles are held so shutdown can abort them. Discarding them meant a
    // client disconnect cancelled nothing: the writer below waited on every
    // in-flight scan, which for a long capture is an hour.
    let mut handlers: JoinSet<()> = JoinSet::new();

    loop {
        let mut line = String::new();
        match read_bounded_line(&mut reader, &mut line).await {
            Ok(0) => break,
            Ok(_) => {}
            // Invalid UTF-8 used to end the whole server through `?`,
            // dropping every in-flight scan and answering nothing -- while
            // malformed *JSON* was handled gracefully two lines below. One
            // stray byte is a bad message, not a reason to exit.
            Err(LineError::Invalid(reason)) => {
                tracing::warn!(reason, "unreadable line on stdin");
                send(&tx, &JsonRpcResponse::parse_error());
                continue;
            }
            Err(LineError::Fatal(e)) => return Err(e.into()),
        }
        let line = line.trim_end().to_string();
        if line.trim().is_empty() {
            continue;
        }

        // Reap finished handlers so the set does not grow for the life of
        // the process.
        while handlers.try_join_next().is_some() {}

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
            if request.method == "notifications/cancelled"
                && inflight.cancel(request.params.as_ref())
            {
                tracing::info!("request cancelled by the client");
            }
            continue;
        }

        // `Option<Option<_>>` distinguishes absent from explicit null; a
        // notification never reaches here, so the outer layer is always Some.
        let id = request.id.clone().flatten();

        // Never wait here. See `MAX_HELD_REQUESTS`.
        let Ok(admitted) = Arc::clone(&held).try_acquire_owned() else {
            tracing::warn!(held = MAX_HELD_REQUESTS, "request refused, server busy");
            send(&tx, &JsonRpcResponse::server_busy(id, MAX_HELD_REQUESTS));
            continue;
        };

        let tx = tx.clone();
        let key = id.as_ref().map(inflight::key);
        let progress = progress::Progress::for_request(request.params.as_ref(), &tx);
        let inflight_for_task = Arc::clone(&inflight);
        let key_for_task = key.clone();
        let slots = Arc::clone(&slots);
        let call = handle(Arc::clone(&state), request);
        let task = async move {
            let _admitted = admitted;
            // Waiting for a slot happens in the task, so the read loop keeps
            // reading and a cancel can reach a request that is still queued.
            let Ok(_slot) = slots.acquire_owned().await else {
                return;
            };
            // A hard ceiling on the whole call, counted from when it starts
            // running. Per-probe timeouts are bounded but their product was
            // not, and a request that never returns holds its slot forever.
            let call = progress::scope(progress, call);
            let response = match tokio::time::timeout(MAX_REQUEST_DURATION, call).await {
                Ok(response) => response,
                Err(_) => {
                    tracing::warn!(
                        timeout_s = MAX_REQUEST_DURATION.as_secs(),
                        "request exceeded the maximum duration"
                    );
                    JsonRpcResponse::request_timeout(id, MAX_REQUEST_DURATION.as_secs())
                }
            };
            match serde_json::to_string(&response) {
                Ok(s) => {
                    let _ = tx.send(s);
                }
                Err(e) => tracing::error!(error = %e, "failed to serialize response"),
            }
            if let Some(key) = key_for_task {
                inflight_for_task.finish(&key);
            }
        };
        match key {
            Some(key) => inflight.track(key, || handlers.spawn(task)),
            None => {
                handlers.spawn(task);
            }
        }
    }

    // EOF: the client is gone, so nothing is waiting for these answers.
    // Aborting is what makes disconnect actually cancel -- the writer used
    // to block until the longest in-flight scan finished, which for an
    // hour-long capture meant an hour.
    let aborted = handlers.len();
    handlers.shutdown().await;
    // Background captures belong to no request, so the line above does not
    // reach them, and they ran to the end of their duration after the client
    // had gone.
    #[cfg(feature = "pcap")]
    if let Ok(state) = state.lock() {
        state.stop_pcap_jobs();
    }
    drop(tx);
    let requests_handled = writer_task.await.unwrap_or(0);

    tracing::info!(
        requests_handled,
        aborted,
        "netscli MCP server shutting down"
    );
    Ok(())
}

#[cfg(test)]
mod tests;
