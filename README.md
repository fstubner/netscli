<div align="center">

<img src="docs/assets/netscli-wordmark.svg" width="420" alt="NETSCLI" />

*A network scanner written in Rust. CLI, terminal UI, desktop app, and MCP server. One library behind all four.*

[![CI](https://github.com/fstubner/netscli/actions/workflows/ci.yml/badge.svg)](https://github.com/fstubner/netscli/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/netscli.svg)](https://crates.io/crates/netscli)
[![Release](https://img.shields.io/github/v/release/fstubner/netscli)](https://github.com/fstubner/netscli/releases)
[![Downloads](https://img.shields.io/github/downloads/fstubner/netscli/total)](https://github.com/fstubner/netscli/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[Documentation](https://netscli.com/docs/)** · **[Install](https://netscli.com/docs/install/)** · **[Changelog](https://netscli.com/changelog/)**

</div>

## Why this exists

The terminal UI came first. I wanted to understand how the newer TUIs work,
the ones coding agents like Claude Code have put real effort into.
Autocomplete, command history, in-place progress, and a UI that does not take
over the terminal, so scrollback and copying text keep working. Building one
seemed like the way to learn it, and a network scanner gave it something to
do.

The MCP server came next. I thought it would be interesting to let an agent
work with a network that way. Ask which device just joined, or whether port 22
is open on some host, instead of shelling out to another tool and parsing
output that was written for a person to read.

Then the CLI, for programmatic use. A script or a cron job wants one command
and JSON back, not an interactive session.

The desktop app came last. Some people would rather have a GUI than a
terminal, and honestly I sometimes prefer it myself over running the commands
locally.

Three of them are the same binary. `netscli <command>` is the CLI, `netscli`
on its own opens the terminal UI, and `netscli serve` starts the MCP server.
The desktop app is a separate download over the same core.

## Screenshots

<div align="center">
  <img src="docs/screenshots/tui-discover.svg" alt="NETSCLI terminal UI running /discover" width="820" />
  <br/><br/>
  <img src="docs/screenshots/gui-scan.png" alt="Desktop app showing port scan results" width="820" />
</div>

## Install

```bash
# macOS / Linux
brew tap fstubner/tap && brew install netscli

# Windows
winget install netscli        # CLI, TUI and MCP server
winget install netscli-gui    # desktop app

# Any platform, via cargo
cargo install netscli
```

Desktop installers for Windows, macOS and Linux are attached to every
[release](https://github.com/fstubner/netscli/releases/latest).

Scoop, the AUR, the one-line install scripts, packet-capture builds and
signature verification are all covered in the
**[install guide](https://netscli.com/docs/install/)**.

## Usage

```bash
netscli discover                     # find hosts on the local subnet
netscli scan 192.168.1.10 -p 22,80,443
netscli inspect example.com          # ping + scan + resolve
netscli dns example.com              # all record types
netscli arp                          # ARP table with vendor lookup
netscli interfaces
```

Every non-interactive command takes `--json` or `--yaml`, so results pipe
straight into `jq`.

Run `netscli` with no arguments for the terminal UI: slash commands with
autocomplete, command history, scrollback and `/export`.

Full command reference: **[CLI](https://netscli.com/docs/cli/)** ·
**[TUI](https://netscli.com/docs/tui/)** ·
**[desktop app](https://netscli.com/docs/desktop/)**

## MCP server

```json
{
  "mcpServers": {
    "netscli": {
      "command": "netscli",
      "args": ["serve"]
    }
  }
}
```

Nine tools by default: discover, scan, ping, DNS, ARP, inspect, sweep,
interfaces and mDNS. Packet-capture builds add four more. Details and the
full schemas are in the **[MCP guide](https://netscli.com/docs/mcp/)**.

## Documentation

| Page | Covers |
| --- | --- |
| [Overview](https://netscli.com/docs/) | What it does, the interface model, safety limits |
| [Installation](https://netscli.com/docs/install/) | Every install route, per platform |
| [CLI](https://netscli.com/docs/cli/) | Commands, flags, structured output |
| [Terminal UI](https://netscli.com/docs/tui/) | Slash commands and session behaviour |
| [Desktop app](https://netscli.com/docs/desktop/) | Tabs, filters, exports |
| [MCP server](https://netscli.com/docs/mcp/) | Tools, schemas, agent setup |
| [Operations](https://netscli.com/docs/operations/) | What each scan actually does |
| [Result model](https://netscli.com/docs/result-model/) | Shape of the JSON and YAML output |
| [Packet capture](https://netscli.com/docs/packet-capture/) | Requirements and the pcap builds |
| [Core library](https://netscli.com/docs/core-library/) | Using `netscli-core` directly |

## Contributing

Issues and pull requests are welcome. Building from source, the desktop app
dev loop, packet-capture builds and the repository layout are all in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
