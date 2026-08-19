---
title: Overview
description: NetsCLI documentation for the shared Rust core, CLI, TUI, desktop app, and MCP server.
---

NetsCLI is a cross-platform network scanner written in Rust. It is built around one shared core library and several interfaces: a desktop app, terminal UI, command-line interface, and MCP server.

The goal is consistency. A port scan, DNS lookup, host inspection, or ARP cache read means the same thing whether you run it from the desktop app, a shell script, the TUI, or an AI agent.

## What NetsCLI does

NetsCLI focuses on practical network inspection tasks:

| Task | Use this when |
| --- | --- |
| Discover hosts | You want to find reachable devices on a subnet. |
| Scan TCP ports | You know a host and want port status, latency, service guesses, and optional banner data. |
| Inspect a host | You want a host profile combining reachability, reverse DNS, and optional port checks. |
| Sweep a subnet | You want discovery plus exposed services across discovered hosts. |
| Query names | You need DNS, reverse DNS, or local mDNS service information. |
| Review local inventory | You need local interfaces or the operating system ARP neighbor cache. |
| Capture packets | You have a packet-capture build and the required system capture library installed. |

NetsCLI is not intended to replace tools such as nmap or Wireshark for advanced service fingerprinting, NSE scripts, deep protocol dissection, or full packet analysis. It covers the common diagnostics where a fast, scriptable, cross-interface tool is useful.

## Interface model

The core library owns network behavior. Interface layers present the data and workflow that fit their environment instead of reimplementing probes, parsers, or safety limits.

| Interface | Best fit |
| --- | --- |
| Desktop app | Tabbed workflows, filtering, row details, history, exports, and result review. |
| Terminal UI | Keyboard-first interactive diagnostics inside a terminal session. |
| CLI | Repeatable commands, scripts, JSON/YAML output, setup, doctor, and shell workflows. |
| MCP server | Structured tools for AI agents that need local network operations. |
| Rust core | Applications that want the shared operations directly. |

## Safety model

Network tools can be easy to overuse. NetsCLI keeps expensive operations bounded in the core library:

- Maximum subnet size is `/16`.
- Maximum ports per scan is `4096`.
- Default scan timeout is `500 ms`.
- Default concurrency is `256`.
- Packet capture requires a packet-capture build and a system capture library.

Interfaces may add confirmations or guidance, but they do not bypass the core limits.

## Useful starting points

- New to NetsCLI: read [Operations](/docs/operations/) first.
- Installing on Windows, macOS, or Linux: read [Installation](/docs/install/).
- Comparing desktop app, TUI, CLI, and MCP coverage: read [Interface coverage](/docs/interface-coverage/).
- Using the desktop app: read [Desktop app](/docs/desktop/).
- Automating scans or exporting JSON/YAML: read [CLI](/docs/cli/).
- Integrating with agents: read [MCP server](/docs/mcp/).
- Building on the Rust crates: read [Core library and crates](/docs/core-library/).
