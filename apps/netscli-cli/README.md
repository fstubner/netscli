# netscli

A network scanner written in Rust. CLI, terminal UI, and MCP server in
one binary.

```bash
cargo install netscli
```

Then:

```bash
netscli              # interactive TUI
netscli discover     # list live hosts on your default subnet
netscli scan host -p 22,80,443 --json | jq
netscli serve        # MCP server (JSON-RPC over stdio)
```

## Surfaces

- **CLI** — `netscli <cmd>` for scripts, cron, and piping into `jq`.
  `--json` and `--yaml` output on every non-interactive subcommand.
- **TUI** — `netscli` alone opens a ratatui-based terminal UI with
  autocomplete, command history, in-place progress, status footer,
  and native scrollback/selection.
- **MCP** — `netscli serve` exposes nine tools over JSON-RPC on stdio
  for Claude Code, Cursor, or any MCP client.

There's also a [desktop app](https://github.com/fstubner/netscli/releases)
that shares the same Rust core but isn't published to crates.io
(Tauri installers are attached to GitHub Releases instead).

## Commands

Host discovery, TCP port scan, subnet sweep, ping, traceroute, DNS
lookup (all record types), reverse DNS, ARP table with vendor
resolution, interface listing, and optional packet capture.

## Packet capture

Install the pcap-enabled variant via the release script:

```bash
NETSCLI_PCAP=1 curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash
```

This picks the right binary variant and also installs the platform's
packet-capture library (libpcap on Linux/macOS, Npcap on Windows). Or
build from source with `cargo build --release -p netscli --features pcap`.

## Full docs

See the main [README](https://github.com/fstubner/netscli) for
screenshots, MCP client configuration, building from source,
cross-compilation, and everything else.

## License

MIT
