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
use clap::{CommandFactory, Parser};
use netscli_core::{Ops, OpsConfig};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    print_first_run_hint(&cli);

    let db = commands::try_init_db().await;
    let ops = Ops::new(OpsConfig {
        concurrency: cli
            .concurrency
            .unwrap_or_else(|| tui_settings::load_settings().max_concurrent_probes),
        ..Default::default()
    });
    // Route enumeration is a blocking syscall; this runs inside the async
    // main, so it delayed every startup path behind it (B-10).
    let local_addr = tokio::task::spawn_blocking(netscli_core::detect_default_ipv4_addr)
        .await
        .ok()
        .flatten()
        .map(|ip| ip.to_string());

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
    } else if terminal_available() {
        tui::run_tui(cli.concurrency).await?;
    } else {
        // No terminal, so the TUI cannot run. Print what `--help` prints and
        // exit 0. See terminal_available below for why this is not an error.
        Cli::command().print_help()?;
        println!();
    }

    Ok(())
}

/// Can the TUI have a terminal to draw on and read from?
///
/// Without this, `netscli` with no subcommand hangs forever anywhere that is
/// not an interactive terminal. `enable_raw_mode` succeeds, and the runtime
/// then sits in `event::poll` waiting for input that cannot arrive. Measured
/// on the released Windows binaries with stdin closed: still running when
/// killed at 15 seconds, on both v0.3.1 and v0.2.6.
///
/// That is a fault on its own -- `netscli | head` has never worked, and
/// neither has running it from a script -- but what forced it is winget.
/// Their validation runs the executable and waits for it, so the CLI's 0.3.1
/// submission has sat since 12 September carrying
/// `Validation-Executable-Error` while the desktop app's went through the
/// same day (microsoft/winget-pkgs#433788). Every release after it would
/// queue behind the same check.
///
/// Both streams, because the TUI reads one and draws to the other, and a
/// harness may redirect either.
///
/// Help and exit 0, rather than an error and a non-zero exit, which would say
/// something truer about what happened. The exit code is what winget's check
/// reads, we cannot see its pipeline to know whether it wants zero or merely
/// an exit, and the cost of guessing wrong is finding out nine days after a
/// release. `docker` with no arguments does the same thing.
///
/// Note that 0.2.2 through 0.2.6 were accepted by winget with this exact
/// behaviour, so what changed is on their side. There is no older netscli to
/// go back to.
fn terminal_available() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

// NOTE: Hostname/IP resolution is shared in netscli-core (`netscli_core::resolve_host_ip`).

fn print_first_run_hint(cli: &Cli) {
    // First-run hint on TUI launch. CLI subcommands stay silent so piped
    // output (`netscli scan host --json | jq`) isn't polluted with hints.
    // `terminal_available` as well as `is_none`: the hint says to type
    // `/help`, which is a TUI command, so it is wrong advice anywhere the TUI
    // is not about to open.
    if cli.command.is_none() && terminal_available() && !setup::config_exists() {
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
