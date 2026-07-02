---
title: Core library and crates
description: NetsCLI Rust crate ownership, core library boundaries, and integration rules.
---

NetsCLI is split into Rust crates and interface apps. `netscli-core` owns network behavior; the CLI, TUI, desktop app, and MCP server call into it rather than carrying separate implementations.

Interface layers use the core `Ops` facade instead of implementing their own probes, packet parsing, DNS behavior, or scan safety logic.

## Crate map

| Crate or app | Owns |
| --- | --- |
| `netscli-core` | Shared network operations, result types, safety limits, packet capture support, persistence, and traffic stats. |
| `netscli` | CLI subcommands, plain-text/JSON/YAML output, setup and doctor commands, and the terminal UI. |
| `netscli-mcp` | MCP JSON-RPC server and tool schemas that wrap core operations. |
| `netscli-gui` | Tauri backend commands plus the React desktop shell, tables, settings, history, exports, and render automation. |

## Dependency direction

Dependency flow stays one-way:

```text
netscli CLI/TUI ┐
netscli-gui     ├─> netscli-core
netscli-mcp     ┘
```

Interface crates may depend on the core. The core must not depend on a UI layer, MCP protocol layer, or desktop runtime.

## Ownership rules

- Put scan, discovery, ping, DNS, ARP, sweep, inspect, stats, database, and packet capture logic in `netscli-core`.
- Expose missing operations through `Ops` so CLI, TUI, desktop app, and MCP all benefit.
- Keep public structures additive when possible.
- Keep safety limits centralized.
- Add core tests when behavior changes.

## Public facade

Most consumers start from `Ops`.

| Type | Role |
| --- | --- |
| `Ops` | High-level async operation facade used by the CLI, TUI, Tauri backend, and MCP server. |
| `OpsConfig` | Runtime limits and defaults for timeouts, concurrency, subnet size, and port count. |
| Result structs | Shared data returned by scans, discovery, DNS, ARP, interfaces, sweep, inspect, and packet capture. |

Expose new behavior through the facade so every interface gets the
same capability and the same safety behavior.

Typical integration shape:

```rust
use netscli_core::{Ops, OpsConfig};

# async fn example() -> anyhow::Result<()> {
let ops = Ops::new(OpsConfig::default());
let (_ip, results) = ops
    .scan_ports("192.168.1.1", Some(vec![22, 80, 443]))
    .await?;
for result in results {
    println!("{} {:?}", result.port, result.status);
}
# Ok(())
# }
```

Exact method signatures can change as operations gain richer structured data. Prefer the current crate docs and compiler errors over copying examples blindly.

## Module map

| Module | Owns |
| --- | --- |
| `scan` | TCP port scanning, status classification, latency, banner, HTTP, and TLS probing. |
| `discover` | Host discovery over a subnet. |
| `inspect` | Host profile data built from reachability, reverse DNS, and port checks. |
| `sweep` | Discovery plus per-host port checks. |
| `dns` | Record lookup and reverse lookup behavior. |
| `mdns` | Local mDNS/DNS-SD service discovery behind the `mdns` feature. |
| `arp` | Local neighbor cache and MAC vendor enrichment. |
| `stats` | Local interface traffic counters. |
| `pcap` | Optional capture execution and packet parsing behind the `pcap` feature. |
| `db` | SQLite persistence for host records and scan history. |
| `ops` | Cross-interface operation orchestration and limits. |

## Interface responsibilities

- CLI: parse arguments and format text, JSON, or YAML.
- TUI: present terminal state and keyboard interactions.
- Desktop app: render app state, tables, settings, details, exports, and Tauri command calls.
- MCP: expose core operations through JSON-RPC tools.
- Tauri backend: bridge desktop app commands to `netscli-core`.

When adding a new network capability:

1. Add the behavior and tests in `netscli-core`.
2. Expose it through `Ops`.
3. Add CLI handling and structured output.
4. Add TUI and desktop app presentation if the workflow fits those interfaces.
5. Add MCP exposure only when an agent use case is clear and safe.
6. Update result-model docs when output fields change.

## Safety limits

NetsCLI intentionally limits expensive operations:

- Maximum subnet size: `/16`.
- Maximum ports per scan: `4096`.
- Default concurrency: `256`.
- Default scan timeout: `500 ms`.

## Compatibility rules

- Change public result structures additively where possible.
- Avoid renaming CLI flags without a breaking-release note.
- Keep MCP tool names and input schemas stable.
- SQLite schema changes require migration planning.
- Desktop-app-only network behavior is not allowed; network logic belongs in the core.
