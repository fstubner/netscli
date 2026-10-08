---
title: MCP server
description: NetsCLI MCP server guide for AI-agent network tools over JSON-RPC.
head:
  - tag: title
    content: Network scanning MCP server for AI agents | NetsCLI docs
---

The MCP server exposes NetsCLI operations to clients such as Claude Code, Cursor, and other MCP-compatible tools. It communicates over stdio using JSON-RPC 2.0.

## Connect a client

There are three ways in. Which one suits you depends on whether netscli is
already on your machine.

### You already have netscli installed

Point the client at the binary you have.

```json
{
  "mcpServers": {
    "netscli": {
      "command": "netscli",
      "args": ["serve"]
    }
  }
}
```

This is the one to prefer. You get the version you installed rather than
whatever is newest, there is no second copy of the binary, and packet capture works, which the other two routes cannot offer.

If the client cannot find `netscli`, give the full path instead. A GUI
client often has a different PATH from your shell.

### You want the server without installing anything

```json
{
  "mcpServers": {
    "netscli": {
      "command": "npx",
      "args": ["-y", "netscli", "serve"]
    }
  }
}
```

npm fetches the prebuilt binary for your platform on first launch. You need
Node 18 or newer. Which version runs is up to npx. It may pick up a newer release or reuse one it has cached, so the version can differ from the one
you have elsewhere. Write `netscli@<version>` in the args to pin one. The npm
builds leave out packet capture, because it needs libpcap or Npcap present on
the machine.

### You would rather not edit a config file

Download the `.mcpb` bundle for your platform from the
[latest release](https://github.com/fstubner/netscli/releases/latest) and
open it with a client that supports MCP bundles. The bundle carries the binary, so nothing else is needed, no PATH entry and no Node.

Bundles are named `netscli-<version>-<platform>-<arch>.mcpb`. Pick the one matching your machine. The format has no way to check that for you, and the
wrong architecture will simply fail to start.

The install prompt includes a switch for scanning beyond your local
networks. Leave it off unless you know you need it. See [Reaching past your local network](#reaching-past-your-local-network).

## Run it yourself

```bash
netscli serve
```

Useful for seeing startup errors. It speaks JSON-RPC on stdin and stdout, so
there is nothing to look at until a client connects.

## Available tools

| Tool | Purpose |
| --- | --- |
| `discover_network` | Discover reachable hosts on a subnet. |
| `scan_ports` | Scan TCP ports on a host, or UDP services with `udp: true`. Returns open ports only unless `include_closed` is true. |
| `ping_host` | Check reachability and latency. |
| `dns_lookup` | Query DNS records. `server` asks a DNS server you name instead of the system's, held to the same target policy as a scan. |
| `get_arp_table` | Read the local ARP neighbor cache. |
| `inspect_host` | Build a host profile with reachability, DNS, MAC address and maker, an OS hint, and ports. |
| `sweep_network` | Discover hosts and scan selected ports. |
| `list_network_interfaces` | List local network interfaces. |
| `discover_mdns` | Discover local mDNS/DNS-SD services. |
| `capture_pcap` | Capture packets in one blocking call when the MCP build includes packet-capture support. |
| `start_pcap_capture` | Start a packet capture job when the MCP build includes packet-capture support. |
| `get_pcap_capture_status` | Poll a packet capture job when packet-capture support is enabled. |
| `get_pcap_capture_result` | Fetch a completed packet capture result when packet-capture support is enabled. |

Tool inputs stay stable. Structured output may gain additive fields as the shared core result model improves.

## A request and its response

Captured from a real session against loopback. The client writes one JSON object per line to stdin, and the server answers on stdout. Most clients do this for you, and this is what they are exchanging.

Opening the connection, then telling the server the client is ready:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"docs","version":"1"}}}
```

```json
{"jsonrpc":"2.0","result":{"capabilities":{"tools":{}},"protocolVersion":"2024-11-05","serverInfo":{"name":"netscli","version":"0.3.5"}},"id":1}
```

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

Calling a tool:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan_ports","arguments":{"host":"127.0.0.1","ports":[22,135,445]}}}
```

The result arrives as MCP text content whose body is the same JSON the CLI
would print, so a model reads one shape wherever it came from:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "text": "[{\"latency_ms\":0,\"open\":true,\"port\":135,\"protocol\":\"tcp\",\"service\":\"msrpc\",\"status\":\"open\"},{\"latency_ms\":0,\"open\":true,\"port\":445,\"protocol\":\"tcp\",\"service\":\"smb\",\"status\":\"open\"}]",
        "type": "text"
      }
    ]
  },
  "id": 2
}
```

Port 22 is missing because it is closed. `scan_ports` and `inspect_host`
leave out closed and filtered ports unless you pass `include_closed: true`,
since on a typical scan they are almost the whole reply. A scan of 1,024
ports on a machine with two open came to 178 bytes this way, and to 93,799
with `include_closed`. An empty list means every port scanned was closed or
filtered.

A tool result is capped at 1 MiB. Past that, its longest list is cut short
and everything else in it is kept. The result then has `truncated` set to
true, and `returned` and `total` say how many items of that list arrived.

Closing stdin cancels any operation still running, packet captures included,
and shuts the server down, which is why a client that exits mid-scan leaves
nothing behind.

## Progress and cancelling

`discover_network`, `scan_ports` and `sweep_network` report progress while
they run, for clients that ask for it by sending a `progressToken` in the
request's `_meta`. The server sends at most four `notifications/progress` a
second, each with how far through the call it is (out of 1000) and a short
message such as `scanning hosts: 16 of 23, 10 found`.

A client can stop any call by sending `notifications/cancelled` with the
call's `requestId`. The scan stops, frees its slot for the next request, and,
as the protocol asks, sends no response for the cancelled call.

The server runs up to 16 calls at once, and up to 16 more wait for a slot. A
cancel still gets through when every slot is busy, and so does closing stdin.
A call beyond those 32 is refused straight away with an error, so a client can
retry it once an earlier call has been answered.

The server also answers `ping` at any time, with an empty result.

## Packet capture jobs

Packet-capture tools appear only in MCP builds that include packet-capture support. Captures also need Npcap on Windows or libpcap on Linux/macOS. Supported builds expose two packet-capture styles.

Use the job-style flow by default. Start the capture, poll status, then fetch the completed result. This avoids MCP client and stdio transport timeouts when captures run longer than expected.

| Flow | Use this when |
| --- | --- |
| `start_pcap_capture` -> `get_pcap_capture_status` -> `get_pcap_capture_result` | Recommended for packet capture, especially when duration, traffic volume, or client timeout behavior is uncertain. |
| `capture_pcap` | Compatibility path for very short captures where the MCP client can safely wait for one blocking response. |

The start call returns a `jobId` and the `outputFile` the capture goes to. Poll with that ID until `resultAvailable` is true, then fetch the result.

Captures are written to the server's working directory. Give `outputFile` as a filename ending in `.pcap`, or leave it out and the server picks a new name. `capture_pcap` names it after the time, and `start_pcap_capture` after the job. A capture never replaces a file that is already there, and never follows a symlink at that name. Choose another name if one is taken.

Without a `duration`, `capture_pcap` stops after 10 seconds, even when you give `maxPackets`. A longer `duration` is cut to 2 minutes.

## Safety model

The MCP server calls the same core operations as the CLI and desktop app. It does not bypass core safety limits for subnet size, port count, concurrency, or timeouts.

Because an MCP client can trigger local network operations, connect it only to clients and workspaces you trust. Treat the server as a local diagnostic tool, not as a remote network service.

### Reaching past your local network

By default this server refuses any target outside your own networks. That means private ranges, loopback, link-local, and carrier-grade NAT, which covers Tailscale and similar overlays. Ask it to scan a public address and it
returns an error rather than sending packets.

Every other part of netscli does what you type. This one is driven by a
model, which may be reading a web page, an issue comment, or a file someone
else wrote, so the instruction to scan a stranger can arrive from outside you entirely, and the packets still leave from your machine and your IP.

Scanning public hosts you are responsible for is a fair reason to lift it:

```bash
NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1 netscli serve
```

In a client config, set it in the server's `env` block. In an `.mcpb`
bundle it is the switch shown when you install.

This is a policy layer, not a security boundary. It stops a model being
steered into scanning strangers. It does not stop you, and it is not meant to. The size limits on subnets, ports and concurrency are separate and still apply either way.

## What stays CLI-only

MCP service installation, environment checks, setup, doctor, shell completions, and manpage generation are CLI workflows. They are not available as MCP tools or in NetsCLI Desktop.

## Troubleshooting

If an MCP client cannot start NetsCLI:

1. Confirm `netscli --help` works in the same shell environment.
2. Use an absolute path to the `netscli` binary in the client config if PATH is different.
3. Run `netscli serve` directly to see startup errors.
4. Use CLI `doctor` or `setup` commands for local dependency checks.
