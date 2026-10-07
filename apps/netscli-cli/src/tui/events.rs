//! TUI slash-command dispatch.
//!
//! `handle_command` is invoked by the TUI's main event loop in
//! [`crate::tui::run_tui`] whenever the user submits a `/foo`-prefixed
//! line. It parses the command, runs the matching `commands::run_*`
//! against a per-command `Ops` built from TUI settings, persists results to the history
//! database (if available), and returns a `Vec<Line<'static>>` ready for
//! the TUI history pane.
//!
//! Originally lived in `main.rs` as `handle_tui_command`; moved here so
//! the TUI's slash-command surface lives next to the rest of the TUI
//! module instead of inflating `main.rs`. The function logic and
//! signature are unchanged — only the home location and the name (now
//! `handle_command` to match its module path).
mod dns;
mod host;
mod network;
mod parse;
mod pcap;
mod scan;

use crate::tui_formatter::Formatter;
use netscli_core::{Database, Ops, PcapCancelToken};
use ratatui::text::Line;
use tokio::sync::watch;

pub async fn handle_command(
    input: String,
    ops: &Ops,
    db: Option<&Database>,
    pcap_cancel: Option<PcapCancelToken>,
    progress: Option<watch::Sender<String>>,
) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    // `/pcap` takes a BPF filter, which has spaces in it, so it alone reads
    // quotes. Every other command is plain words.
    let quoted;
    let parts: Vec<&str> = if input.split_whitespace().next() == Some("/pcap") {
        match crate::tui_args::split_args(&input) {
            Ok(words) => {
                quoted = words;
                quoted.iter().map(String::as_str).collect()
            }
            Err(e) => {
                out.push(Formatter::format_error(&format!(
                    "Could not read the command: {e}"
                )));
                return out;
            }
        }
    } else {
        input.split_whitespace().collect()
    };
    if parts.is_empty() {
        return out;
    }
    match parts[0] {
        "/discover" => {
            out.extend(scan::handle_discover(&parts, ops, db, progress.clone()).await);
        }
        "/scan" => {
            out.extend(scan::handle_scan(&parts, ops, db, progress.clone()).await);
        }
        "/inspect" => {
            out.extend(scan::handle_inspect(&parts, ops, db).await);
        }
        "/sweep" => {
            out.extend(scan::handle_sweep(&parts, ops, db, progress.clone()).await);
        }
        "/dns" => {
            out.extend(dns::handle_lookup(&parts, ops, db).await);
        }
        "/reverse" => {
            out.extend(dns::handle_reverse(&parts, ops, db).await);
        }
        "/ping" => {
            out.extend(host::handle_ping(&parts, ops, progress.clone()).await);
        }
        "/trace" => {
            out.extend(host::handle_trace(&parts, progress.clone()).await);
        }
        "/arp" => out.extend(network::handle_arp(&parts, ops).await),
        "/interfaces" => {
            out.extend(network::handle_interfaces(ops));
        }
        "/mdns" => {
            out.extend(network::handle_mdns(&parts, ops, progress.clone()).await);
        }
        "/pcap" => {
            out.extend(pcap::handle(&parts, ops, db, pcap_cancel, progress.clone()).await);
        }
        "/help" => {
            out.extend(crate::tui::help_lines());
        }
        "/quit" | "/exit" => {}
        other => {
            out.push(Formatter::format_error(&format!(
                "Unknown command: {}",
                other
            )));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use netscli_core::OpsConfig;

    /// What a command prints, as one string. Every case here is refused
    /// before anything touches the network.
    async fn run(input: &str) -> String {
        let ops = Ops::new(OpsConfig::default());
        let lines = handle_command(input.to_string(), &ops, None, None, None).await;
        lines
            .iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[tokio::test]
    async fn commands_say_what_they_could_not_read() {
        // These each used to carry on with a default, or show something else.
        assert!(run("/ping 127.0.0.1 abc").await.contains("Invalid count"));
        assert!(run("/discover 10.0.0.0/24 192.168.0.0/24")
            .await
            .contains("Unexpected argument"));
        assert!(run("/mdns --timeout abc")
            .await
            .contains("Invalid --timeout"));
        assert!(run("/arp add 10.0.0.5").await.contains("Usage: /arp"));
    }

    #[tokio::test]
    async fn pcap_reads_quotes_and_says_when_one_is_never_closed() {
        let said = run(r#"/pcap eth0 --filter "tcp port 80"#).await;
        assert!(said.contains("Could not read the command"), "{said}");
    }
}
