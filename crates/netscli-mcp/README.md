# netscli-mcp

Model Context Protocol (MCP) server exposing
[`netscli-core`](https://crates.io/crates/netscli-core) tools to LLM
agents over JSON-RPC on stdio.

Most users want the
[`netscli`](https://crates.io/crates/netscli) binary crate and run
`netscli serve`. This crate is the library it wraps, for embedding the
same MCP surface inside a different host process.

## Exposed tools

- `discover_network` — live hosts on a subnet.
- `scan_ports` — TCP port scan on a host.
- `ping_host` — ping with packet-loss and RTT statistics.
- `dns_lookup` — forward or reverse DNS, all record types.
- `get_arp_table` — ARP/neighbour table with vendor resolution.
- `inspect_host` — comprehensive host inspection (ping + scan + DNS).
- `sweep_network` — discovery + port scan in one call.
- `list_network_interfaces` — interfaces with addresses and MAC.
- `capture_pcap` — network packet capture to a `.pcap` file (requires
  `pcap` feature in netscli-core and libpcap/Npcap at runtime).

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

## License

MIT
