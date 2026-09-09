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

<div data-ui-table="row-headers"></div>

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
| `raw` | Bounded raw diagnostic preview when available. |
| `error` | Probe error text when the scanner could not complete a normal open, closed, or filtered result. |

`filtered` means the connection attempt timed out or was blocked before connect.

Banner, HTTP, TLS, and raw preview data are probe results. They are useful diagnostics, not proof that a service is trustworthy.

## Host inventory

Discovery and sweep results describe hosts. A host row carries:

<div data-ui-table="row-headers"></div>

| Field | Meaning |
| --- | --- |
| `ip` | Host address. |
| `hostname` | Reverse DNS or local name when available. |
| `mac` | MAC address when present in ARP/vendor data. |
| `vendor` | OUI vendor lookup. |
| `rtt_ms` | Reachability latency. |
| `found_by` | Which probe found the host. |

Discovery prioritizes inventory. Sweep adds exposed-service data by scanning selected ports on discovered hosts.

### Sweep nests the host

`discover` returns those rows directly, so `.[]` is a host:

```bash
netscli discover --json | jq '.[].ip'
```

`sweep` returns a different shape. Each entry pairs a whole host object with
the ports found open on it, so the host fields are one level down:

```json
[
  {
    "host": { "ip": "192.168.1.1", "hostname": "router.local", "rtt_ms": 3 },
    "open_ports": [{ "port": 443, "open": true, "status": "open" }]
  }
]
```

```bash
netscli sweep 192.168.1.0/24 -p 22,80,443 --json | jq '.[].host.ip'
```

This page used to list `open_ports` in the table above as a "sweep-only"
field, which read as though it sat beside `ip`. It does not, on any surface —
the CLI and the MCP `sweep_network` tool both serialize the nested form.

## DNS records

DNS records expose type and value first, then additive metadata when the resolver provides it.

<div data-ui-table="row-headers"></div>

| Field | Meaning |
| --- | --- |
| `record_type` | A, AAAA, CNAME, MX, NS, TXT, SRV, PTR, SOA, CAA, or another supported record family. |
| `value` | Display value for the record. |
| `ttl_seconds` | TTL when available. |
| `name` | Owner name when available. |
| `resolver_source` | Resolver source when NetsCLI can report it. |

When `ALL` records are requested, some record families can fail while others succeed. When at least one record is returned, interfaces present the lookup as partial results rather than a total failure.

## Inspect results

Inspect is a host profile. It combines host-level data with optional port scan data.

<div data-ui-table="row-headers"></div>

| Field | Meaning |
| --- | --- |
| `host` | Original target. |
| `ip` | Resolved IP address. |
| `hostname` | Reverse DNS name when available. |
| `ping` | Reachability object with `alive`, `method`, `rtt_ms`, `seq`, and optional `error`. |
| `ports` | Port scan rows using the same model as `scan`. |
| `open_ports` | Convenience list containing only open port rows. |

## mDNS services

mDNS/DNS-SD returns service announcements rather than generic host rows. A single device can announce multiple services.

<div data-ui-table="row-headers"></div>

| Field | Meaning |
| --- | --- |
| `full_name` | Full service instance name. |
| `hostname` | Host that owns the service. |
| `service_type` | DNS-SD service type, such as `_http._tcp.local.`. |
| `addresses` | IPv4 and IPv6 addresses resolved for the service host. |
| `port` | Service port. |
| `properties` | TXT record key/value properties. |

## Interfaces and ARP

Interface rows describe local network interfaces. ARP rows describe the local
neighbor cache. These are two different shapes, and unlike everywhere else on
this page, the desktop app does not show them under the field names the data
carries — so both are given here.

### Interfaces

<div data-ui-table="row-headers"></div>

| Field | Desktop column | Meaning |
| --- | --- | --- |
| `name` | Interface | Interface name. |
| `ips` | Addresses | Addresses assigned to the interface, with prefix length. |
| `mac` | MAC | MAC address when available. |
| `is_up` | State | Whether the interface is up. Boolean in the data; the desktop app renders it as `up` or `down`. |
| `is_loopback` | — | Whether the interface is loopback. Boolean in the data. The desktop app has no column for it directly; it feeds the Kind column below. |

The desktop table adds one column with no field behind it: **Kind**, derived
from `is_loopback` and the interface name, showing `loopback`, `virtual`,
`vpn` or `physical`.

### ARP entries

<div data-ui-table="row-headers"></div>

| Field | Desktop column | Meaning |
| --- | --- | --- |
| `ip` | IP | Neighbor address. |
| `mac` | MAC | Neighbor MAC address. |
| `interface` | Interface | Interface the entry was learned on. |
| `vendor` | Vendor | OUI vendor lookup for the MAC address. |

Take the first column when reading `--json`, `--yaml` or MCP output, and the
second when reading the desktop table.

This section previously merged the two shapes into one list and gave
`addresses`, `state` and `loopback` as field names. None of the three is a
field: `addresses` is a column *header* over `ips`, `state` is a desktop row
key derived from `is_up`, and `loopback` is a desktop row key that is not even
shown as a column. `vendor` was also listed as though it applied to
interfaces, which it does not.

ARP is not full discovery. It reports entries already known to the operating system.

## Packet capture results

Packet capture results are available only in builds compiled with packet-capture support.

<div data-ui-table="row-headers"></div>

| Field | Meaning |
| --- | --- |
| `index` | Packet number within the capture. |
| `timestamp` | Packet timestamp where available. |
| `source` | Best parsed source endpoint. |
| `destination` | Best parsed destination endpoint. |
| `protocol` | Parsed protocol family. |
| `length` | Captured packet length. |
| `captured_length` | Number of bytes captured for this packet. |
| `info` | Human-oriented packet summary. |
| `source_port` / `destination_port` | Transport ports when parsed. |
| `tcp_flags` | TCP flags when parsed. |
| `icmp_type` / `icmp_code` | ICMP metadata when parsed. |
| `arp_operation` | ARP operation when parsed. |
| `ethernet_source` / `ethernet_destination` | Ethernet addresses when parsed. |
| `hex_preview` | Bounded byte preview for quick inspection. |
