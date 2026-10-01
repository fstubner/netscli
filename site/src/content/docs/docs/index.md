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
| Scan ports | You know a host and want TCP or UDP port status, latency, the software and version where a service names itself, and banner data. |
| Inspect a host | You want a host profile: reachability, reverse DNS, MAC address and maker, an OS hint, and optional port checks. |
| Sweep a subnet | You want discovery plus exposed services across discovered hosts. |
| Query names | You need DNS, reverse DNS, or local mDNS service information. |
| Review local inventory | You need local interfaces or the operating system ARP neighbor cache. |
| Capture packets | You have a packet-capture build and the required system capture library installed. |

NetsCLI is not intended to replace tools such as nmap or Wireshark for advanced service fingerprinting, NSE scripts, deep protocol dissection, or full packet analysis. It covers the common diagnostics where a fast, scriptable, cross-interface tool is useful.

## Interface model

Every interface runs the same core library, so results and limits are the same whichever you use. Each one presents them in the way that suits it.

| Interface | Best fit |
| --- | --- |
| Desktop app | Tabbed workflows, filtering, row details, history, exports, and result review. |
| Terminal UI | Keyboard-first interactive diagnostics inside a terminal session. |
| CLI | Repeatable commands, scripts, JSON, YAML, CSV and Markdown output, setup, doctor, and shell workflows. |
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
- Automating scans or exporting JSON, YAML, CSV or Markdown: read [CLI](/docs/cli/).
- Integrating with agents: read [MCP server](/docs/mcp/).
- Building on the Rust crates: read [Core library and crates](/docs/core-library/).
