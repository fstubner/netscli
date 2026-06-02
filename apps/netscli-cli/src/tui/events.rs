//! TUI slash-command dispatch.
//!
//! `handle_command` is invoked by the TUI's main event loop in
//! [`crate::tui::run_tui`] whenever the user submits a `/foo`-prefixed
//! line. It parses the command, runs the matching `commands::run_*`
//! against the shared `Ops` instance, persists results to the history
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
    let parts: Vec<&str> = input.split_whitespace().collect();
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
