---
title: MCP server
description: NetsCLI MCP server guide for AI-agent network tools over JSON-RPC.
---

The MCP server exposes NetsCLI operations to clients such as Claude Code, Cursor, and other MCP-compatible tools. It communicates over stdio using JSON-RPC 2.0.

## Start the server

```bash
netscli serve
```

Most users do not run this command directly. Instead, they configure an MCP client to launch it.

Example client configuration:

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

## What stays CLI-only

MCP service installation, environment checks, setup, doctor, shell completions, and manpage generation are CLI workflows. They are not exposed in NetsCLI Desktop and do not need MCP tools unless they become shared core operations with a clear agent use case.

## Troubleshooting

If an MCP client cannot start NetsCLI:

1. Confirm `netscli --help` works in the same shell environment.
2. Use an absolute path to the `netscli` binary in the client config if PATH is different.
3. Run `netscli serve` directly to see startup errors.
4. Use CLI `doctor` or `setup` commands for local dependency checks.
