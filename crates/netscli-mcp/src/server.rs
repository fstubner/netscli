mod dispatch;
mod errors;
#[cfg(feature = "pcap")]
mod jobs;
mod limits;
mod operations;
mod protocol;
mod schemas;
mod targets;
mod tools;

use std::sync::{Arc, Mutex};

use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::{mpsc, Semaphore};
use tokio::task::JoinSet;

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

/// Longest any single request may run before it is abandoned.
///
/// The per-probe timeouts are bounded, but nothing bounded probes multiplied
/// by timeout: `ping_host` with `count=256` at the 10-minute per-probe
/// ceiling is roughly 42 hours, and it holds one of the permits above for
/// all of it. Sixteen such calls wedged the server with no way back.
const MAX_REQUEST_DURATION: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// Longest line accepted on stdin.
///
/// `next_line` grows a `String` without limit, so a client that sends
/// megabytes and no newline was an unbounded allocation.
const MAX_REQUEST_LINE_BYTES: usize = 4 * 1024 * 1024;

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
    // `.take()` bounds a single line; `lines()` on its own grows without
    // limit. The reader is rebuilt per line below so the cap applies to each.
    let mut reader = BufReader::new(stdin);
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
            continue;
        }

        // The permit is taken *here*, before spawning, so the semaphore
        // bounds admission and not merely execution. Acquiring it inside the
        // task meant a client could stack up unbounded tasks, each holding a
        // full `params` value, faster than they completed; backpressure now
        // reaches stdin, which is where it can actually slow the client down.
        //
        // Reading the next line still does not wait on the handler, so a slow
        // `sweep_network` does not block requests queued behind it.
        let Ok(permit) = Arc::clone(&limiter).acquire_owned().await else {
            break;
        };

        let state = Arc::clone(&state);
        let tx = tx.clone();
        // `Option<Option<_>>` distinguishes absent from explicit null; a
        // notification never reaches here, so the outer layer is always Some.
        let id = request.id.clone().flatten();
        handlers.spawn(async move {
            let _permit = permit;
            // A hard ceiling on the whole call. Per-probe timeouts are
            // bounded but their product was not, and a request that never
            // returns holds its permit forever.
            let response =
                match tokio::time::timeout(MAX_REQUEST_DURATION, handle_request(state, request))
                    .await
                {
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
        });
    }

    // EOF: the client is gone, so nothing is waiting for these answers.
    // Aborting is what makes disconnect actually cancel -- the writer used
    // to block until the longest in-flight scan finished, which for an
    // hour-long capture meant an hour.
    let aborted = handlers.len();
    handlers.shutdown().await;
    drop(tx);
    let requests_handled = writer_task.await.unwrap_or(0);

    tracing::info!(
        requests_handled,
        aborted,
        "netscli MCP server shutting down"
    );
    Ok(())
}

/// Why a line could not be read.
enum LineError {
    /// The bytes were not a usable line, but the transport is still fine.
    Invalid(&'static str),
    /// The transport itself failed.
    Fatal(std::io::Error),
}

/// Read one line, bounded, treating undecodable bytes as a bad message
/// rather than the end of the server.
async fn read_bounded_line<R>(reader: &mut R, out: &mut String) -> Result<usize, LineError>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let mut raw = Vec::new();
    // One byte past the limit, so an over-long line is detected rather than
    // silently truncated into something that might still parse as JSON.
    let mut limited = tokio::io::AsyncReadExt::take(reader, MAX_REQUEST_LINE_BYTES as u64 + 1);
    let read = limited
        .read_until(b'\n', &mut raw)
        .await
        .map_err(LineError::Fatal)?;
    if read == 0 {
        return Ok(0);
    }
    if raw.len() > MAX_REQUEST_LINE_BYTES {
        return Err(LineError::Invalid("line exceeds the maximum request size"));
    }
    match String::from_utf8(raw) {
        Ok(text) => {
            out.push_str(&text);
            Ok(read)
        }
        Err(_) => Err(LineError::Invalid("line is not valid UTF-8")),
    }
}
