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

<svg viewBox="0 0 720 300" role="img" width="100%"
     aria-label="Dependency graph: netscli (CLI, TUI and serve) depends on netscli-mcp and on netscli-core; netscli-mcp depends on netscli-core; netscli-gui depends on netscli-core; netscli-core depends on none of them"
     style="max-width:720px;height:auto;margin-block:1.25rem">
  <defs><marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--sl-color-gray-3, #8b919b)"/></marker></defs>
  <g fill="none" stroke="var(--sl-color-gray-3, #8b919b)" stroke-width="1.5" marker-end="url(#dep-arrow)"><path d="M170 86 L170 112"/><path d="M300 52 L360 52 L360 210"/><path d="M170 176 L170 196 L250 196 L250 210"/><path d="M540 86 L540 196 L470 196 L470 210"/></g>
  <g stroke="var(--sl-color-gray-4, #3a3f46)" stroke-width="1.5" fill="none"><rect x="40" y="20" width="260" height="66" rx="8"/><rect x="420" y="20" width="240" height="66" rx="8"/><rect x="40" y="112" width="260" height="64" rx="8"/></g>
  <rect x="200" y="210" width="320" height="66" rx="8" stroke="var(--ui-accent, #22c55e)" stroke-width="2" fill="none"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" fill="var(--sl-color-white, #ffffff)" text-anchor="middle"><text x="170" y="48">netscli</text><text x="540" y="48">netscli-gui</text><text x="170" y="140">netscli-mcp</text><text x="360" y="240">netscli-core</text></g>
  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="11.5" fill="var(--sl-color-gray-3, #8b919b)" text-anchor="middle"><text x="170" y="70">CLI · TUI · serve</text><text x="540" y="70">Tauri desktop app</text><text x="170" y="160">JSON-RPC tools</text><text x="360" y="262">operations, result types, safety limits</text></g>
</svg>

Interface crates may depend on the core. The core must not depend on a UI layer, MCP protocol layer, or desktop runtime.

The CLI additionally depends on `netscli-mcp`, because `netscli serve` runs
the MCP server in-process — the one edge between two interface crates. The
diagram previously showed all three as siblings, which made `netscli serve`
look impossible.

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
| `OpsConfig` | Runtime defaults for scan, ping and DNS timeouts, plus probe concurrency. |
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
| `ping` | Reachability probing, with the ICMP and TCP-connect backends. |
| `trace` | Route hops, over the platform trace tool. |
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
