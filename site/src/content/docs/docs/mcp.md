---
title: MCP server
description: NetsCLI MCP server guide for AI-agent network tools over JSON-RPC.
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
whatever is newest, there is no second copy of the binary, and packet
capture works — the other two routes cannot offer it.

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
Node 18 or newer. Which version runs is up to npx: it may pick up a newer
release or reuse one it has cached, so the version can differ from the one
you have elsewhere. Write `netscli@0.3.3` in the args to pin one. The npm
builds leave out packet capture, because it needs libpcap or Npcap present on
the machine.

### You would rather not edit a config file

Download the `.mcpb` bundle for your platform from the
[latest release](https://github.com/fstubner/netscli/releases/latest) and
open it with a client that supports MCP bundles. The bundle carries the
binary, so nothing else is needed — no PATH entry, no Node.

Bundles are named `netscli-<version>-<platform>-<arch>.mcpb`. Pick the one
matching your machine; the format has no way to check that for you, and the
wrong architecture will simply fail to start.

The install prompt includes a switch for scanning beyond your local
networks. Leave it off unless you know you need it — see
[Reaching past your local network](#reaching-past-your-local-network).

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
| `scan_ports` | Scan TCP ports on a host. |
| `ping_host` | Check reachability and latency. |
| `dns_lookup` | Query DNS records. |
| `get_arp_table` | Read the local ARP neighbor cache. |
| `inspect_host` | Build a host profile from reachability, DNS, and ports. |
| `sweep_network` | Discover hosts and scan selected ports. |
| `list_network_interfaces` | List local network interfaces. |
| `discover_mdns` | Discover local mDNS/DNS-SD services. |
| `capture_pcap` | Capture packets in one blocking call when the MCP build includes packet-capture support. |
| `start_pcap_capture` | Start a packet capture job when the MCP build includes packet-capture support. |
| `get_pcap_capture_status` | Poll a packet capture job when packet-capture support is enabled. |
| `get_pcap_capture_result` | Fetch a completed packet capture result when packet-capture support is enabled. |

Tool inputs stay stable. Structured output may gain additive fields as the shared core result model improves.

## A request and its response

Captured from a real session against loopback. The client writes one JSON
object per line to stdin; the server answers on stdout. Most clients do this
for you — this is what they are exchanging.

Opening the connection:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"docs","version":"1"}}}
```

```json
{"jsonrpc":"2.0","result":{"capabilities":{"tools":{}},"protocolVersion":"2024-11-05","serverInfo":{"name":"netscli","version":"0.3.1"}},"error":null,"id":1}
```

Calling a tool:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan_ports","arguments":{"host":"127.0.0.1","ports":[22,80,443]}}}
```

The result arrives as MCP text content whose body is the same JSON the CLI
would print, so a model reads one shape wherever it came from:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[\n  {\n    \"open\": false,\n    \"port\": 22,\n    \"service\": \"ssh\",\n    \"status\": \"filtered\"\n  },\n  {\n    \"open\": false,\n    \"port\": 80,\n    \"service\": \"http\",\n    \"status\": \"filtered\"\n  },\n  {\n    \"open\": false,\n    \"port\": 443,\n    \"service\": \"https\",\n    \"status\": \"filtered\"\n  }\n]"
      }
    ]
  },
  "error": null,
  "id": 2
}
```

Every port reads `filtered` because nothing is listening on loopback for
those ports. Closing stdin cancels any operation still running and shuts the
server down, which is why a client that exits mid-scan leaves nothing behind.

## Packet capture jobs

Packet-capture tools appear only in MCP builds that include packet-capture support. Captures also need Npcap on Windows or libpcap on Linux/macOS. Supported builds expose two packet-capture styles.

Use the job-style flow by default: start the capture, poll status, then fetch the completed result. This avoids MCP client and stdio transport timeouts when captures run longer than expected.

| Flow | Use this when |
| --- | --- |
| `start_pcap_capture` -> `get_pcap_capture_status` -> `get_pcap_capture_result` | Recommended for packet capture, especially when duration, traffic volume, or client timeout behavior is uncertain. |
| `capture_pcap` | Compatibility path for very short captures where the MCP client can safely wait for one blocking response. |

The start call returns a `jobId`. Poll with that ID until `resultAvailable` is true, then fetch the result.

## Safety model

The MCP server calls the same core operations as the CLI and desktop app. It does not bypass core safety limits for subnet size, port count, concurrency, or timeouts.

Because an MCP client can trigger local network operations, connect it only to clients and workspaces you trust. Treat the server as a local diagnostic tool, not as a remote network service.

### Reaching past your local network

By default this server refuses any target outside your own networks —
private ranges, loopback, link-local, and carrier-grade NAT, which covers
Tailscale and similar overlays. Ask it to scan a public address and it
returns an error rather than sending packets.

Every other part of netscli does what you type. This one is driven by a
model, which may be reading a web page, an issue comment, or a file someone
else wrote, so the instruction to scan a stranger can arrive from outside
you entirely — and the packets still leave from your machine and your IP.

Scanning public hosts you are responsible for is a fair reason to lift it:

```bash
NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1 netscli serve
```

In a client config, set it in the server's `env` block. In an `.mcpb`
bundle it is the switch shown when you install.

This is a policy layer, not a security boundary. It stops a model being
steered into scanning strangers. It does not stop you, and it is not meant
to — the size limits on subnets, ports and concurrency are separate and
still apply either way.

## What stays CLI-only

MCP service installation, environment checks, setup, doctor, shell completions, and manpage generation are CLI workflows. They are not exposed in NetsCLI Desktop and do not need MCP tools unless they become shared core operations with a clear agent use case.

## Troubleshooting

If an MCP client cannot start NetsCLI:

1. Confirm `netscli --help` works in the same shell environment.
2. Use an absolute path to the `netscli` binary in the client config if PATH is different.
3. Run `netscli serve` directly to see startup errors.
4. Use CLI `doctor` or `setup` commands for local dependency checks.
