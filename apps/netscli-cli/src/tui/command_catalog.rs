//! TUI slash-command catalog.
//!
//! Defines the typed [`CommandDef`] descriptor, the platform-conditional
//! `COMMAND_DEFS` arrays (one with the `/pcap` entry when built with the
//! `pcap` feature, one without), and the [`help_lines`] renderer that
//! produces the `/help` output.
//!
//! Originally lived inline in `tui.rs`; extracted so the slash-command
//! schema sits next to the dispatch logic in `events.rs` rather than
//! inside the TuiApp file. `build_suggestion_line` (the row renderer)
//! still lives in `widgets.rs` because other render paths use it too.
use super::palette::palette;
use super::widgets::build_suggestion_line;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

#[derive(Clone, Copy, Debug)]
pub struct CommandDef {
    pub cmd: &'static str,
    pub desc: &'static str,
    pub args: &'static str,
}

#[cfg(feature = "pcap")]
pub(super) const COMMAND_DEFS: &[CommandDef] = &[
    CommandDef {
        cmd: "/discover",
        desc: "Discover hosts on network",
        args: "[subnet]",
    },
    CommandDef {
        cmd: "/scan",
        desc: "Scan TCP ports on host",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/inspect",
        desc: "Inspect host (ping + scan + resolve)",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/sweep",
        desc: "Sweep network (discover + scan)",
        args: "[subnet] [ports] [--no-resolve]",
    },
    CommandDef {
        cmd: "/dns",
        desc: "DNS lookup",
        args: "<host> [--record <type>|ALL]",
    },
    CommandDef {
        cmd: "/reverse",
        desc: "Reverse DNS lookup",
        args: "<ip>",
    },
    CommandDef {
        cmd: "/ping",
        desc: "Ping host",
        args: "<host> [count]",
    },
    CommandDef {
        cmd: "/trace",
        desc: "Trace route (hops)",
        args: "<host> [--resolve] [--max-hops <n>]",
    },
    CommandDef {
        cmd: "/arp",
        desc: "Show ARP table",
        args: "",
    },
    CommandDef {
        cmd: "/interfaces",
        desc: "List network interfaces",
        args: "",
    },
    CommandDef {
        cmd: "/mdns",
        desc: "Discover devices via mDNS/Bonjour",
        args: "[--timeout <ms>]",
    },
    CommandDef {
        cmd: "/config",
        desc: "Configure TUI settings (interactive)",
        args: "",
    },
    CommandDef {
        cmd: "/export",
        desc: "Export session output",
        args: "[md|json] [--output <path>]",
    },
    CommandDef {
        cmd: "/pcap",
        desc: "Packet capture (requires privileges)",
        args: "[--check] <iface> [--filter <expr>] [--duration <secs>] [--output <file>] [--max-packets <n>]",
    },
    CommandDef {
        cmd: "/help",
        desc: "Show command help",
        args: "",
    },
    CommandDef {
        cmd: "/exit",
        desc: "Exit",
        args: "",
    },
];

#[cfg(not(feature = "pcap"))]
pub(super) const COMMAND_DEFS: &[CommandDef] = &[
    CommandDef {
        cmd: "/discover",
        desc: "Discover hosts on network",
        args: "[subnet]",
    },
    CommandDef {
        cmd: "/scan",
        desc: "Scan TCP ports on host",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/inspect",
        desc: "Inspect host (ping + scan + resolve)",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/sweep",
        desc: "Sweep network (discover + scan)",
        args: "[subnet] [ports] [--no-resolve]",
    },
    CommandDef {
        cmd: "/dns",
        desc: "DNS lookup",
        args: "<host> [--record <type>|ALL]",
    },
    CommandDef {
        cmd: "/reverse",
        desc: "Reverse DNS lookup",
        args: "<ip>",
    },
    CommandDef {
        cmd: "/ping",
        desc: "Ping host",
        args: "<host> [count]",
    },
    CommandDef {
        cmd: "/trace",
        desc: "Trace route (hops)",
        args: "<host> [--resolve] [--max-hops <n>]",
    },
    CommandDef {
        cmd: "/arp",
        desc: "Show ARP table",
        args: "",
    },
    CommandDef {
        cmd: "/interfaces",
        desc: "List network interfaces",
        args: "",
    },
    CommandDef {
        cmd: "/mdns",
        desc: "Discover devices via mDNS/Bonjour",
        args: "[--timeout <ms>]",
    },
    CommandDef {
        cmd: "/config",
        desc: "Configure TUI settings (interactive)",
        args: "",
    },
    CommandDef {
        cmd: "/export",
        desc: "Export session output",
        args: "[md|json] [--output <path>]",
    },
    CommandDef {
        cmd: "/help",
        desc: "Show command help",
        args: "",
    },
    CommandDef {
        cmd: "/exit",
        desc: "Exit",
        args: "",
    },
];

pub fn help_lines() -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = Vec::new();
    lines.push(Line::from(Span::styled(
        "Commands",
        Style::default()
            .fg(palette().text)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::default());
    for def in COMMAND_DEFS {
        lines.push(build_suggestion_line("  ", *def, false, usize::MAX));
    }
    lines
}
