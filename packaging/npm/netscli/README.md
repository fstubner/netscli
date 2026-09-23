# netscli

Network diagnostics CLI, terminal UI, and MCP server, written in Rust.
Discovery, port scans, ping, DNS, ARP, mDNS — with structured JSON output
and an MCP server so a model can use the same operations.

Full documentation: **[netscli.com](https://netscli.com)**

## Use it without installing

```bash
npx netscli scan-ports 192.168.1.1
```

This package carries no code of its own. It declares one small package per
platform and npm fetches the single prebuilt binary that matches yours.

## As an MCP server

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

**If you already have netscli installed, use the binary instead** — set
`"command": "netscli"` and drop the `npx -y`. You get the version you chose
rather than whatever `latest` resolves to at launch, you skip a second copy
of a 13 MB binary, and packet capture works, which it cannot here.

## What is missing from the npm build

- **Packet capture.** `capture_pcap` and the capture jobs need libpcap or
  Npcap on the machine, so those builds are not published to npm. Everything
  else works.
- **The desktop app.** GUI installers come from the
  [releases page](https://github.com/fstubner/netscli/releases) or a system
  package manager.
- **Anything outside linux-x64, linux-arm64, darwin-x64, darwin-arm64 and
  windows-x64.** Other targets are built, just not shipped here.

For those, and for a copy on your PATH that your system updates:

```bash
winget install fstubner.netscli     # Windows
brew install fstubner/tap/netscli   # macOS
cargo install netscli               # anywhere with Rust
```

## Scanning other people's networks

The MCP server refuses targets outside your local networks unless you set
`NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1`. The CLI does not — it does what you
type.

The split is deliberate. The MCP server is the one surface where the
instruction to scan something can come from a web page or a file a model
read, rather than from you, and the packets leave from your machine and your
IP either way. Scanning hosts you own is a fair reason to set the variable.

## License

MIT
