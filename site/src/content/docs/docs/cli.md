---
title: CLI
description: NetsCLI command-line usage for scripts, terminals, JSON, YAML, and repeatable diagnostics.
head:
  - tag: title
    content: Command-line network scanner (CLI) | NetsCLI docs
---

Use the CLI for repeatable diagnostics, automation, and machine-readable output.

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

Commands that return a list also take `--csv`, for a spreadsheet or a script that wants columns, and `--md`, for a Markdown table to paste into an issue or a wiki. They are `discover`, `scan`, `sweep`, `dns`, `ping`, `arp`, `interfaces`, `mdns` and `pcap`.

```bash
netscli discover 192.168.1.0/24 --csv > hosts.csv
netscli scan 192.168.1.1 -p 22,80,443 --csv
```

```console
$ netscli dns netscli.com --record A --csv
record_type,value,name,ttl_seconds,resolver_source
A,172.67.141.41,netscli.com,273,system
A,104.21.33.43,netscli.com,273,system

$ netscli dns netscli.com --record A --md
| record_type | value | name | ttl_seconds | resolver_source |
| --- | --- | --- | --- | --- |
| A | 104.21.33.43 | netscli.com | 273 | system |
| A | 172.67.141.41 | netscli.com | 273 | system |
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

Captured from a real run against loopback, so every port reads `closed`, because nothing is listening on 127.0.0.1 for these ports and the host refuses the connection. A host with services up
returns `open` with latency, and a banner where one was offered.

```console
$ netscli scan 127.0.0.1 -p 22,80,443 --json
[
  {
    "port": 22,
    "protocol": "tcp",
    "open": false,
    "status": "closed",
    "service": "ssh",
    "latency_ms": 4
  },
  {
    "port": 80,
    "protocol": "tcp",
    "open": false,
    "status": "closed",
    "service": "http",
    "latency_ms": 0
  },
  {
    "port": 443,
    "protocol": "tcp",
    "open": false,
    "status": "closed",
    "service": "https",
    "latency_ms": 0
  }
]
```

`open` is the compatibility boolean older consumers already read, and `status` carries the full answer, including `open|filtered` for UDP. Both are present, so a script written against
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

## Exit codes

A script can branch on the exit code, and the command still prints its output before it exits.

| Code | Meaning |
| --- | --- |
| `0` | The command worked. |
| `1` | The command ran and failed. A lookup failed, nothing answered, a tool it relies on failed, or a dependency the build needs is missing. |
| `2` | The command line was wrong. That covers an unknown command or flag, a value out of range such as `ping -c 0`, and two output formats at once. |

What counts as a failure for the commands where it is not obvious:

- `ping` exits 1 when no reply came back at all, after printing the summary with `loss=100.0%`. A host that answers some of the pings exits 0, whatever the loss.
- `trace` exits 1 when `tracert`, `traceroute` or `tracepath` fails, for example on a name it cannot resolve. A route that ends without an answer from the last hop is not a failure, because those tools exit 0 for it.
- `doctor` exits 1 when a dependency the build needs is missing. That is libpcap, or Npcap on Windows, in a build with packet capture. A missing tcpdump is reported and exits 0, and so does a standard build that has no packet capture. The `required` field in `doctor --json` says which is which.
- `dns --record ALL` exits 0 when any record type has records, because most names have no `MX` or `SRV`. It exits 1 when none do.
- `mcp-service --install` exits 1, because it no longer installs anything.

## Command list

The CLI exposes shared network operations plus command-line maintenance workflows:

| Command | Purpose |
| --- | --- |
| `discover` | Find reachable hosts on a subnet. |
| `scan` | Scan TCP ports on one host, or UDP services with `--udp`. |
| `inspect` | Build a host profile with reachability, reverse DNS, MAC address and maker, an OS hint, and optional ports. |
| `sweep` | Discover hosts and scan selected ports across them. |
| `ping` | Measure reachability and packet loss. |
| `trace` | Show route hops to a host. |
| `dns` | Query DNS records. |
| `reverse` | Reverse lookup an IP address. |
| `mdns` | Discover local mDNS/DNS-SD service announcements. |
| `interfaces` | List local network interfaces. |
| `arp` | Read the local ARP neighbor cache. |
| `pcap` | Capture or parse packets when built with packet-capture support. It will not replace an existing capture file unless you pass `--force`. |
| `serve` | Run the MCP server over stdio. Your MCP client starts it, as the [MCP guide](/docs/mcp/) shows. |
| `mcp-service` | Remove the systemd unit that 0.3.4 and earlier installed. It no longer installs one. |
| `setup` / `doctor` | Check local environment and dependencies. |
| `completions` / `man` | Generate shell completions or a man page. |

## Help and flags

Use command-specific help for exact flags:

```bash
netscli --help
netscli scan --help
netscli dns --help
```

`--concurrency` / `-j` is a global option for limiting in-flight network work. It is useful on fragile gateways or when scanning larger local ranges. Without it the limit is 256, or the value you saved with `/config` in the terminal UI.

The help output is the source of truth for flags. The docs explain workflow and intent, and the binary explains exact syntax.

### Environment variables

| Variable | Effect |
| --- | --- |
| `NETSCLI_HISTORY=1` | Keep every result in a local database. See [Local history](#local-history). |
| `NO_COLOR` | No colour, in the output or in the terminal UI. |
| `CLICOLOR_FORCE=1` | Colour the output even when it is piped, for `less -R` or a CI log. |

The output also has no colour when `TERM` is `dumb`, and when it is not going to a terminal.

## CLI-only workflows

Some workflows intentionally stay in the command-line interface:

- `setup` and `doctor` for local environment checks.
- `serve` to start the MCP server, and `mcp-service --uninstall` to remove the systemd unit that earlier versions installed.
- Shell completions and manpage generation.

## Local history

NetsCLI 0.3.4 and earlier kept a copy of every result in a database at `~/.netscli/netscli.db`, whether or not you wanted one. Nothing in NetsCLI reads it back yet, so from 0.3.5 it is off. NetsCLI no longer opens or creates the file unless you ask, and does not create the `~/.netscli` folder for it.

To keep history, set `NETSCLI_HISTORY=1` where you run `netscli`. Every `discover`, `scan`, `inspect`, `sweep`, `dns`, `reverse` and `pcap` run, from the command line or the terminal UI, then stores its full result there, along with the devices it found. Nothing prunes it, so it grows. On Linux and macOS a folder and file that NetsCLI creates for it are readable by you alone. One that already exists keeps the permissions it has.

NetsCLI never deletes the file for you. If an earlier version left one, it is still there, and deleting `~/.netscli/netscli.db` is how you get rid of it.


## Permissions and limits

Raw ICMP, traceroute, and packet capture can require elevated permissions depending on the platform. Port scans and DNS lookups normally do not.

Limits on subnet size, port count, concurrency, and timeouts apply the same way in every interface.

A request that breaks one of two limits is refused with an error. A subnet larger than a /16 is, and so is a scan of more than 4,096 ports.

Four others cut the value to fit and carry on, without saying so.

- `--concurrency` is held between 1 and 1024.
- `ping -c` is held to 256 pings at most.
- `trace --max-hops` is held between 1 and 255.
- `mdns --timeout-ms` waits 30 seconds at most.
