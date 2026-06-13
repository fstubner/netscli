---
title: Result model
description: Reference for NetsCLI result shapes shared by CLI, desktop app, TUI, MCP, and the Rust core.
---

NetsCLI keeps result data shared across interfaces. Desktop app tables, CLI JSON/YAML, TUI output, MCP tools, and Rust structs describe the same underlying operation.

## Compatibility

Structured output is designed to be additive:

- Existing field names remain stable.
- New fields may appear as the core library captures richer data.
- Missing optional data is represented as absent, null, empty, or `-` in human output depending on the interface.
- Consumers can safely ignore unknown fields.

## Port results

Port scans include the existing compatibility fields plus richer status data.

| Field | Meaning |
| --- | --- |
| `port` | TCP port number. |
| `open` | Compatibility boolean for older consumers. |
| `service` | Best-effort service guess. |
| `status` | `open`, `closed`, `filtered`, or `error`. |
| `latency_ms` | TCP connect/probe latency where available. |
| `banner` | Bounded plaintext banner when captured. |
| `http` | HTTP status/header data when a HTTP-like probe succeeds. |
| `tls` | TLS metadata when a TLS probe succeeds. |
| `raw_preview` | Bounded raw diagnostic preview when available. |

`filtered` means the connection attempt timed out or was blocked before connect.

Banner, HTTP, TLS, and raw preview data are probe results. They are useful diagnostics, not proof that a service is trustworthy.

## Host inventory

Discovery and sweep results describe hosts.

| Field | Meaning |
| --- | --- |
| `ip` | Host address. |
| `hostname` | Reverse DNS or local name when available. |
| `mac` | MAC address when present in ARP/vendor data. |
| `vendor` | OUI vendor lookup. |
| `rtt` | Reachability latency. |
| `open_ports` | Sweep-only exposed service count. |
| `ports` | Sweep-only open port list. |

Discovery prioritizes inventory. Sweep adds exposed-service data by scanning selected ports on discovered hosts.

## DNS records

DNS records expose type and value first, then additive metadata when the resolver provides it.

| Field | Meaning |
| --- | --- |
| `record_type` | A, AAAA, MX, NS, TXT, SOA, CAA, and related record families. |
| `value` | Display value for the record. |
| `ttl_seconds` | TTL when available. |
| `name` | Owner name when available. |
| `resolver_source` | Resolver source when NetsCLI can report it. |

When `ALL` records are requested, some record families can fail while others succeed. When at least one record is returned, interfaces present the lookup as partial results rather than a total failure.

## Inspect results

Inspect is a host profile. It combines host-level data with optional port scan data.

| Field | Meaning |
| --- | --- |
| `host` | Original target. |
| `ip` | Resolved IP address. |
| `hostname` | Reverse DNS name when available. |
| `status` | Reachability status. |
| `latency_ms` | Reachability latency when available. |
| `ports` | Optional port scan rows using the same model as `scan`. |

## Interfaces and ARP

Interface rows describe local network interfaces. ARP rows describe the local neighbor cache.

| Field | Meaning |
| --- | --- |
| `name` / `interface` | Interface name or interface address associated with the row. |
| `ips` / `addresses` | Interface addresses. |
| `mac` | MAC address when available. |
| `state` | Interface state such as up or down. |
| `loopback` | Whether the interface is loopback where known. |
| `vendor` | OUI vendor lookup for MAC addresses where available. |

ARP is not full discovery. It reports entries already known to the operating system.

## Packet capture results

Packet capture results are available only in feature-enabled builds.

| Field | Meaning |
| --- | --- |
| `number` | Packet number within the capture. |
| `time` | Packet timestamp or relative time where available. |
| `source` | Best parsed source endpoint. |
| `destination` | Best parsed destination endpoint. |
| `protocol` | Parsed protocol family. |
| `length` | Captured packet length. |
| `info` | Human-oriented packet summary. |
| `fields` | Optional parsed Ethernet/IP/TCP/UDP/ICMP/ARP fields. |
| `hex_preview` | Bounded byte preview for quick inspection. |
