#![allow(clippy::uninlined_format_args)]

mod args;
mod cli_dispatch;
mod cli_formatter;
mod commands;
mod mcp_service;
mod output;
mod setup;
mod trace;
mod tui;
mod tui_export;
mod tui_formatter;
mod tui_settings;

use anyhow::Result;
use args::Cli;
use clap::Parser;
use netscli_core::{Ops, OpsConfig, DEFAULT_CONCURRENCY};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    print_first_run_hint(&cli);

    let db = commands::try_init_db().await;
    let ops = Ops::new(OpsConfig {
        concurrency: cli.concurrency.unwrap_or(DEFAULT_CONCURRENCY),
        ..Default::default()
    });
    let local_addr = netscli_core::detect_default_ipv4_addr().map(|ip| ip.to_string());

    if let Some(command) = &cli.command {
        cli_dispatch::run_command(
            command,
            cli_dispatch::CommandContext {
                ops: &ops,
                db: db.as_ref(),
                local_addr: local_addr.as_deref(),
            },
        )
        .await?;
    } else {
        tui::run_tui(cli.concurrency.unwrap_or(DEFAULT_CONCURRENCY)).await?;
    }

    Ok(())
}

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).

fn print_first_run_hint(cli: &Cli) {
    // First-run hint on TUI launch. CLI subcommands stay silent so piped
    // output (`netscli scan host --json | jq`) isn't polluted with hints.
    if cli.command.is_none() && !setup::config_exists() {
        #[cfg(feature = "pcap")]
        eprintln!(
            "netscli: first run detected. Type `/help` for commands, or run `netscli setup` to install optional dependencies (libpcap, tcpdump)."
        );
        #[cfg(not(feature = "pcap"))]
        eprintln!(
            "netscli: first run detected. Type `/help` for commands. (This build has pcap disabled — rebuild with --features pcap to enable capture.)"
        );
    }
}
