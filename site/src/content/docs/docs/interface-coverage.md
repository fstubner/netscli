---
title: Interface coverage
description: What NetsCLI exposes in the desktop app, CLI, TUI, MCP server, and packet-capture builds.
---

NetsCLI has one Rust core library and several interfaces. Shared network behavior belongs in the core; each interface exposes the parts that fit its job.

## Coverage matrix

<div data-netscli-table="row-headers"></div>

| Capability | Desktop app | TUI | CLI | MCP |
| --- | --- | --- | --- | --- |
| Discover hosts | Yes | Yes | Yes | Yes |
| Scan TCP ports | Yes | Yes | Yes | Yes |
| Inspect host | Yes | Yes | Yes | Yes |
| Sweep subnet | Yes | Yes | Yes | Yes |
| Ping | Yes | Yes | Yes | Yes |
| Trace route | Yes | Yes | Yes | No |
| DNS lookup | Yes | Yes | Yes | Yes |
| Reverse DNS | Yes | Yes | Yes | No |
| mDNS discovery | Yes | Yes | Yes | Yes |
| Interfaces | Yes | Yes | Yes | Yes |
| ARP neighbor cache | Yes | Yes | Yes | Yes |
| Packet capture | Packet-capture build | Packet-capture build | Packet-capture build | Packet-capture build |
| JSON/YAML output | Export-oriented | Session export | Yes | JSON-RPC |
| Result bundles | Yes | No | No | No |
| Setup and doctor | No | No | Yes | No |
| MCP service management | No | No | Yes | No |

## Desktop app

The desktop app focuses on interactive network work: tabs, filtering, row selection, details, history, exports, and local status indicators.

It exposes shared operations where a table or details pane improves the workflow. Shell maintenance workflows such as setup, doctor, completions, manpages, and MCP service management stay in the CLI.

## CLI

The CLI exposes shared network operations plus command-line maintenance workflows:

- Structured output through `--json` and `--yaml`.
- Setup and dependency checks.
- MCP server launch and service management where supported.
- Shell completions and manpage generation.

## TUI

The terminal UI is for keyboard-driven interactive work inside a terminal. It stays close to the CLI operation model while favoring readable summaries and terminal-native navigation. It can export the current session as Markdown or JSON with `/export`.

## MCP server

The MCP server exposes shared network operations to AI-agent clients. It does not define desktop UI behavior, and desktop app actions do not depend on MCP service-management code.

## Build and runtime availability

Most NetsCLI operations work in the standard published builds. A few capabilities depend on how the app was packaged or what is installed on the machine:

- Packet Capture appears only in builds that include packet-capture support. Capturing packets also needs Npcap on Windows or libpcap on Linux/macOS.
- mDNS discovery is included in the published CLI, desktop app, and MCP server. Library consumers can still build `netscli-core` without the `mdns` feature if they need a leaner dependency set.
- The desktop app keeps Packet Capture visible even in builds without capture support, and shows setup guidance in place of results. Tools whose feature is genuinely absent from the build, such as mDNS discovery, are hidden.
- If a runtime dependency is missing, NetsCLI keeps the rest of the app usable and explains what to install for that feature.
