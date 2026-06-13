mod dispatch;
mod errors;
#[cfg(feature = "pcap")]
mod jobs;
mod operations;
mod protocol;
mod schemas;
mod tools;

use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};

use dispatch::{handle_request, ServerState};
use protocol::{JsonRpcRequest, JsonRpcResponse};

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
    let mut writer = BufWriter::new(stdout);
    let mut state = ServerState::default();
    let mut requests_handled: u64 = 0;

    while let Some(line) = reader.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(req) => req,
            Err(e) => {
                tracing::warn!(error = %e, "json parse error");
                let response = JsonRpcResponse::parse_error();
                let response_str = serde_json::to_string(&response)?;
                writer.write_all(response_str.as_bytes()).await?;
                writer.write_all(b"\n").await?;
                writer.flush().await?;
                continue;
            }
        };

        // Notifications (no id) must not get a response.
        if request.id.is_none() {
            tracing::debug!(method = %request.method, "notification");
            if request.method == "notifications/initialized" {
                state.initialized = true;
            }
            continue;
        }

        let response = handle_request(&mut state, request).await;
        let response_str = serde_json::to_string(&response)?;
        writer.write_all(response_str.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
        requests_handled += 1;
    }

    tracing::info!(requests_handled, "netscli MCP server shutting down");
    Ok(())
}
