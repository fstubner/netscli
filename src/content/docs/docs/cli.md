---
title: CLI
description: NetsCLI command-line usage for scripts, terminals, JSON, YAML, and repeatable diagnostics.
head:
  - tag: title
    content: Command-line network scanner (CLI) | NetsCLI docs
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

### CSV and Markdown

Commands that return a list also take `--csv`, for a spreadsheet or a script
that wants columns, and `--md`, for a Markdown table to paste into an issue
or a wiki: `discover`, `scan`, `sweep`, `dns`, `ping`, `arp`, `interfaces`,
`mdns` and `pcap`.

```bash
netscli discover 192.168.1.0/24 --csv > hosts.csv
netscli scan 192.168.1.1 -p 22,80,443 --csv
```

```console
$ netscli dns netscli.com --record MX --csv
record_type,value,name,ttl_seconds,resolver_source
MX,10 eforward1.registrar-servers.com,netscli.com,300,public_fallback

$ netscli dns netscli.com --record MX --md
| record_type | value | name | ttl_seconds | resolver_source |
| --- | --- | --- | --- | --- |
| MX | 10 eforward1.registrar-servers.com | netscli.com | 300 | public\_fallback |
```

- **Columns are the JSON field names**, in the same order, so a script can
  switch between `--json` and `--csv` without renaming anything. Both table
  formats have the same columns and rows.
- **One row per result:** a host, a port, a DNS record, a packet. `ping` is
  one summary row. `sweep` is one row per open port, with the host's fields
  repeated on each, plus one row for a host that answered with nothing open.
- **Lists are joined with `;`** (`22;80;443`). Anything nested, such as a
  port's HTTP or TLS details, is that value's JSON in a single cell.
- **Columns come from the results.** A field no result has, like `error` on
  a clean scan, has no column, and an empty result prints nothing at all.
- **Text from the network is made safe.** In CSV, a cell that would start
  with `=`, `+`, `-` or `@` gets a leading `'`, so a hostname or banner can't
  run as a spreadsheet formula. In Markdown, characters that mean something
  there, `|`, `<` and `*` among them, are backslash-escaped, so a banner can't
  break the table or add HTML, and line breaks become `<br>`. In both,
  control characters become `.` so they can't reach your terminal. Use
  `--json` when you need those bytes exactly.

## Example output

Captured from a real run against loopback, so every port reads `filtered` —
nothing is listening on 127.0.0.1 for these ports. A host with services up
returns `open` with latency, and a banner where one was offered.

```console
$ netscli scan 127.0.0.1 -p 22,80,443 --json
[
  {
    "port": 22,
    "open": false,
    "status": "filtered",
    "service": "ssh"
  },
  {
    "port": 80,
    "open": false,
    "status": "filtered",
    "service": "http"
  },
  {
    "port": 443,
    "open": false,
    "status": "filtered",
    "service": "https"
  }
]
```

`open` is the compatibility boolean older consumers already read; `status`
carries the four-way answer. Both are present, so a script written against
either keeps working.

```console
$ netscli ping 127.0.0.1 -c 3
PING 127.0.0.1 (127.0.0.1)
sent=3 received=3 loss=0.0%
rtt min/avg/max = 0/0.0/0 ms
```

```console
$ netscli dns localhost
DNS A
  127.0.0.1

DNS AAAA
  ::1

DNS PTR
  localhost
```

The same lookup with `--json` adds the fields a script needs:

```console
$ netscli dns localhost --json
[
  {
    "record_type": "A",
    "value": "127.0.0.1",
    "name": "localhost",
    "ttl_seconds": 86400,
    "resolver_source": "system"
  }
]
```

## Command list

The CLI exposes shared network operations plus command-line maintenance workflows:

| Command | Purpose |
| --- | --- |
| `discover` | Find reachable hosts on a subnet. |
| `scan` | Scan TCP ports on one host, or UDP services with `--udp`. |
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
