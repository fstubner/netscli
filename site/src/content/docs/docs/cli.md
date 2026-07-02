---
title: CLI
description: NetsCLI command-line usage for scripts, terminals, JSON, YAML, and repeatable diagnostics.
---

The CLI is the best interface for repeatable diagnostics, automation, and machine-readable output.

## Common commands

```bash
# Discover devices on the default local subnet.
netscli discover

# Discover a specific subnet.
netscli discover 192.168.1.0/24

# Scan common service ports on a host.
netscli scan 192.168.1.1 -p 22,80,443

# Inspect reachability, reverse DNS, and selected ports.
netscli inspect 192.168.1.1 -p 22,80,443

# Sweep a subnet for hosts with selected services.
netscli sweep 192.168.1.0/24 -p 22,80,443

# Query DNS records.
netscli dns netscli.com --record ALL

# Start the MCP server for agent integrations.
netscli serve
```

## Structured output

Use `--json` or `--yaml` when another tool needs stable data.

```bash
netscli scan 192.168.1.1 -p 22,80,443 --json
netscli dns netscli.com --record ALL --yaml
```

Structured output is additive. New fields may appear over time, but existing field names remain stable unless a breaking release says otherwise.

Example script pattern:

```bash
netscli discover --json | jq '.[].ip'
```

## Command list

The CLI exposes shared network operations plus command-line maintenance workflows:

| Command | Purpose |
| --- | --- |
| `discover` | Find reachable hosts on a subnet. |
| `scan` | Scan TCP ports on one host. |
| `inspect` | Build a host profile from reachability, reverse DNS, and optional ports. |
| `sweep` | Discover hosts and scan selected ports across them. |
| `ping` | Measure reachability and packet loss. |
| `trace` | Show route hops to a host. |
| `dns` | Query DNS records. |
| `reverse` | Reverse lookup an IP address. |
| `mdns` | Discover local mDNS/DNS-SD service announcements. |
| `interfaces` | List local network interfaces. |
| `arp` | Read the local ARP neighbor cache. |
| `pcap` | Capture or parse packets when built with packet-capture support. |
| `serve` | Run the MCP server over stdio. |
| `mcp-service` | Manage MCP server auto-start on supported systems. |
| `setup` / `doctor` | Check local environment and dependencies. |
| `completions` / `man` | Generate shell completions or a man page. |

## Help and flags

Use command-specific help for exact flags:

```bash
netscli --help
netscli scan --help
netscli dns --help
```

`--concurrency` / `-j` is a global option for limiting in-flight network work. It is useful on fragile gateways or when scanning larger local ranges.

The help output is the source of truth for flags. The docs explain workflow and intent; the binary explains exact syntax.

## CLI-only workflows

Some workflows intentionally stay in the command-line interface:

- `setup` and `doctor` for local environment checks.
- `serve` and `mcp-service` for MCP server launch and supported service management.
- Shell completions and manpage generation.

The desktop app exposes shared network operations and result exploration. It does not duplicate maintenance workflows unless they become shared core operations with a clear interactive use case.

## Permissions and limits

Raw ICMP, traceroute, and packet capture can require elevated permissions depending on the platform. Port scans and DNS lookups normally do not.

The core library enforces safety limits for subnet size, port count, concurrency, and timeouts. Interface-specific code does not bypass those limits.
