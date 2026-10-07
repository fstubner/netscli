# netscli-mcp

Model Context Protocol (MCP) server exposing
[`netscli-core`](https://crates.io/crates/netscli-core) tools to LLM
agents over JSON-RPC on stdio.

Most users want the
[`netscli`](https://crates.io/crates/netscli) binary crate and run
`netscli serve`. This crate is the library it wraps, for embedding the
same MCP surface inside a different host process.

## Exposed tools

| Tool | What it does |
| --- | --- |
| `discover_network` | Live hosts on a subnet. |
| `scan_ports` | TCP port scan on a host, or UDP with `udp: true`. Open ports only unless `include_closed: true`. |
| `ping_host` | Ping with packet-loss and RTT statistics. |
| `dns_lookup` | Forward DNS, all record types. Reverse lookups are not exposed over MCP. |
| `get_arp_table` | ARP/neighbour table with vendor resolution. |
| `inspect_host` | Ping, port scan, reverse DNS, MAC vendor on the local segment, and an OS hint with the evidence behind it. |
| `sweep_network` | Discovery + port scan in one call. |
| `list_network_interfaces` | Interfaces with addresses and MAC. |
| `discover_mdns` | mDNS/DNS-SD (Bonjour) device discovery. Needs the `mdns` feature, which is enabled by default. |

With the `pcap` feature (requires libpcap/Npcap at runtime), four more:

| Tool | What it does |
| --- | --- |
| `capture_pcap` | Network packet capture to a `.pcap` file in one blocking tool call. |
| `start_pcap_capture` | Start a capture as a background job for longer captures. |
| `get_pcap_capture_status` | Poll a capture job's running/completed/failed status. |
| `get_pcap_capture_result` | Fetch a completed capture job's result. |

All tool calls return structured JSON so agents don't have to scrape
human-oriented output.

## Using it standalone

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    netscli_mcp::run_server().await
}
```

This runs a JSON-RPC MCP server on stdin/stdout. Point your MCP client
(Claude Code, Cursor, etc.) at the resulting binary.

## MCP client config

For Claude Desktop / Code, with the `netscli` binary installed:

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

## Which hosts it will scan

By default this server only scans the local networks: RFC1918 ranges,
loopback, link-local, and the carrier-grade NAT range that overlay networks
like Tailscale use. A request aimed anywhere else is refused.

The reason is that this surface is driven by a model rather than by the
person at the keyboard, and a model may be reading a web page, an issue
comment, or a file someone else wrote. The size limits bound how much can be
scanned in one call. They say nothing about whose network it is, and the
packets leave from your machine and your IP.

To scan public hosts, your own servers for instance, start the server with
the opt-in:

```json
{
  "mcpServers": {
    "netscli": {
      "command": "netscli",
      "args": ["serve"],
      "env": { "NETSCLI_MCP_ALLOW_PUBLIC_TARGETS": "1" }
    }
  }
}
```

This is a policy, not a sandbox. It stops a model being talked into scanning
a stranger. It does not constrain whoever starts the server.

## License

MIT
