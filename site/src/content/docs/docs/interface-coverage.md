---
title: Interface coverage
description: What NetsCLI exposes in the desktop app, CLI, TUI, MCP server, and packet-capture builds.
---

One Rust core library sits under everything NetsCLI offers. Shared network
behaviour belongs in the core; each surface exposes the parts that suit how
it is used.

## What the surfaces actually are

**Three of the four are the same binary.** `netscli` with a command is the
CLI, `netscli` with no command opens the terminal UI, and `netscli serve`
starts the MCP server. Installing the CLI installs all three. The desktop app
is a separate download built on the same core.

That matters when reading the table below: a dash in the MCP column does not
mean you need another install to get that capability, only that the MCP
server does not expose it as a tool.

## Coverage matrix

<div data-netscli-table="row-headers"></div>

| Capability | Desktop app | CLI | TUI | MCP |
| --- | --- | --- | --- | --- |
| Discover hosts | ✓ | ✓ | ✓ | ✓ |
| Scan TCP ports | ✓ | ✓ | ✓ | ✓ |
| Inspect host | ✓ | ✓ | ✓ | ✓ |
| Sweep subnet | ✓ | ✓ | ✓ | ✓ |
| Ping | ✓ | ✓ | ✓ | ✓ |
| Trace route | ✓ | ✓ | ✓ | – |
| DNS lookup | ✓ | ✓ | ✓ | ✓ |
| Reverse DNS | ✓ | ✓ | ✓ | – |
| mDNS discovery | ✓ | ✓ | ✓ | ✓ |
| List interfaces | ✓ | ✓ | ✓ | ✓ |
| Read the ARP table | ✓ | ✓ | ✓ | ✓ |
| Change the ARP table | ✓ | ✓ | ✓ | – |
| Packet capture | ✓ | ✓ | ✓ | ✓ |
| Structured output | ✓ | ✓ | ✓ | ✓ |
| Result bundles | ✓ | – | – | – |
| First-run setup | – | ✓ | – | – |
| Diagnostics | – | ✓ | – | – |
| MCP service management | – | ✓ | – | – |
| Completions and man page | – | ✓ | – | – |

✓ available here · – not offered here

### Notes on the dashes

- **Trace route** has no MCP tool. Everything else it needs is in the core,
  so this is a gap rather than a decision.
- **Reverse DNS** on the MCP server means asking `dns_lookup` for a `PTR`
  record, which works but wants the `in-addr.arpa` name rather than an
  address. The other three take an address directly.
- **Changing the ARP table** needs administrator rights and edits machine
  state, which is not something to hand an agent. The desktop app offers
  clearing only; the CLI and TUI also add and delete single entries.
- **Result bundles** are the desktop app's own save format, for reopening a
  run later. The equivalent elsewhere is structured output: `--json` and
  `--yaml` on the CLI, `/export` in the TUI, JSON-RPC results over MCP.
- **First-run setup** (`netscli setup`) and **diagnostics**
  (`netscli doctor`) are two different commands and used to share a row here.
  Setup is an interactive wizard; doctor is a headless report that works on
  every build and is the way to find out what your build can do.

### Notes on the ticks

- **Packet capture** needs a build compiled with the feature *and* the system
  capture library — Npcap on Windows, libpcap elsewhere. No published build
  has it. See [Installation](/docs/install/#packet-capture).
- **Structured output** means something different on each surface, which is
  why it is one row rather than four: the desktop app exports files and
  result bundles, the CLI takes `--json` and `--yaml`, the TUI exports a
  session with `/export`, and the MCP server returns JSON-RPC results.

## Desktop app

Interactive network work: tabs, filtering, row selection, a details pane,
history, exports, and local status indicators. It exposes the shared
operations where a table or a details pane earns its place.

Shell maintenance — setup, doctor, completions, man pages, MCP service
management — stays in the CLI, because none of it benefits from a window.

## CLI — `netscli <command>`

Every shared network operation, plus the workflows that only make sense at a
prompt:

- `--json` and `--yaml` on every operation.
- `netscli setup` for the first-run wizard, `netscli doctor` for a headless
  capability report.
- `netscli serve` to start the MCP server, and `netscli mcp-service` to
  manage it as a system service where that is supported.
- `netscli completions` and `netscli man`.

## TUI — `netscli` with no command

The same operations, driven from a terminal with slash commands (`/discover`,
`/scan`, `/inspect`, and the rest) rather than arguments. It favours readable
summaries and keyboard navigation, and exports the session as Markdown or
JSON with `/export`.

It is the same binary as the CLI, so anything installed for one is installed
for the other.

## MCP server — `netscli serve`

Exposes the shared operations to AI-agent clients as MCP tools. Also the same
binary.

Results are bounded before they reach a model: the full probe response is
dropped, banners and packet summaries are truncated, and an oversized result
is cut with a count of what was left out. A scanned host's banner is bytes
that host chose, and a model reads tool output as instructions.

## Build and runtime availability

Most NetsCLI operations work in the standard published builds. A few capabilities depend on how the app was packaged or what is installed on the machine:

- Packet capture runs only on builds that include packet-capture support, and also needs Npcap on Windows or libpcap on Linux/macOS. On the CLI the `pcap` subcommand is absent from standard builds.
- mDNS discovery is included in the published CLI, desktop app, and MCP server. Library consumers can still build `netscli-core` without the `mdns` feature if they need a leaner dependency set.
- The desktop app keeps Packet Capture visible in builds without capture support — greyed, with an explanation of what it needs — rather than hiding it. A tool that vanishes leaves nowhere to explain why.
- If a runtime dependency is missing, NetsCLI keeps the rest of the app usable and explains what to install for that feature.
