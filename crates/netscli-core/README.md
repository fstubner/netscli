# netscli-core

The library behind [netscli](https://github.com/fstubner/netscli). If
you want the CLI, the TUI, the desktop app, or the MCP server, use the
[`netscli`](https://crates.io/crates/netscli) binary crate. This crate
is for building your own tools on top of the same primitives.

## What's in here

- **Host discovery** (`DiscoverEngine`) over a subnet via ARP cache and
  active probes.
- **Port scanning** (`PortScanner`) with configurable concurrency and
  per-connect timeouts.
- **DNS resolution** (`resolve_a`, `resolve_aaaa`, full record-type
  lookups) via `hickory-resolver`.
- **Ping** (`PingScanner`) with structured RTT summaries.
- **Network sweep** (`SweepEngine`) combining discovery and scanning.
- **Interface listing** (`NetworkManager`) with ARP neighbour tables
  and **MAC vendor lookup** (`lookup_vendor`) against a bundled
  gzipped IEEE OUI dataset.
- **Host inspection** (`InspectEngine`) combining ping + scan + DNS.
- **Live traffic stats** (`NetworkMonitor`) via `sysinfo`.
- **Optional packet capture** (`PcapEngine`) behind the `pcap` feature
  flag.
- **SQLite persistence** (`Database`) for scan history and host
  labelling.

## Quick example

```rust
use netscli_core::{parse_ports_checked, PortScanner};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // `parse_ports_checked` rejects port 0 and enforces the per-scan cap;
    // it returns `None` when no port string was supplied, so fall back to
    // the defaults rather than unwrapping.
    let ports = parse_ports_checked(Some("22,80,443"))?.unwrap_or_default();

    let scanner = PortScanner::new(100); // max concurrent connections
    let target = "192.168.1.1".parse()?;
    let results = scanner.scan_host(target, ports, 500).await; // timeout_ms

    for result in results {
        // `PortResult` carries the port, not the host — the host is the
        // `target` you passed in.
        println!("{}:{} open={}", target, result.port, result.open);
    }
    Ok(())
}
```

## Features

| Feature | Default | Purpose |
|---------|---------|---------|
| `db`    | off     | Enables the `Database` type and SQLite persistence via sqlx + chrono. Pulls ~90 extra transitive crates, so library consumers who don't need scan history should leave this off. |
| `pcap`  | off     | Enables `PcapEngine` packet capture. Needs libpcap/Npcap at runtime. |

The `netscli` binary crate enables `db` by default (it uses `Database`
for scan history). Library consumers who only want the scan / DNS /
ARP primitives should add the dep with `default-features = false`.

## OUI vendor data

The IEEE OUI vendor database ships embedded in the crate (~400 KB
gzipped). Vendor lookups work with zero runtime setup. If you want to
ship a newer or filtered dataset:

- Set `NETSCLI_OUI_PATH` to a path pointing at `.json` or `.json.gz`.
- Or place `oui.min.json.gz` next to the executable.

On-disk paths take precedence over the embedded copy.

## License

MIT
