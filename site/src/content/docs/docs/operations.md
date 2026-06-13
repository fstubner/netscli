---
title: Operations
description: Practical NetsCLI operation guide for discovery, scan, inspect, sweep, DNS, reverse DNS, mDNS, interfaces, ARP, ping, trace, and packet capture.
---

Each NetsCLI operation answers a different question. Choose the operation by what you need to learn, not by which interface you are using.

## Quick chooser

| Question | Operation |
| --- | --- |
| Which hosts are alive on this subnet? | `discover` |
| Which TCP ports are open, closed, filtered, or errored on this host? | `scan` |
| What is the basic profile of this host? | `inspect` |
| Which discovered hosts expose selected ports? | `sweep` |
| Is this host reachable and how stable is it? | `ping` |
| Which route does traffic take to this host? | `trace` |
| Which DNS records exist for this name? | `dns` |
| Which name maps back from this IP address? | `reverse` |
| Which local services are advertised with mDNS? | `mdns` |
| Which local interfaces are present? | `interfaces` |
| Which neighbors are in the local ARP cache? | `arp` |
| What packets are visible on this interface? | `pcap` |

## Discover

Use `discover` when you want an inventory of reachable hosts on a subnet.

```bash
netscli discover 192.168.1.0/24
```

Discovery focuses on host-level data: IP address, hostname when available, MAC address, vendor, and response time. It does not scan service ports. Use `sweep` when you also need exposed services.

## Scan

Use `scan` when you already know the host and want TCP port status.

```bash
netscli scan 192.168.1.1 -p 22,80,443
```

Port statuses are:

| Status | Meaning |
| --- | --- |
| `open` | TCP connect succeeded. NetsCLI may attempt bounded banner, HTTP, or TLS enrichment. |
| `closed` | The host actively refused the TCP connection. |
| `filtered` | The TCP connect attempt timed out or was blocked before connect. |
| `error` | NetsCLI hit an unexpected probe error. |

`filtered` is intentionally technical. It usually means a firewall, router, host policy, or dropped packet prevented a definitive open or closed answer.

## Inspect

Use `inspect` when you want a host profile rather than only a port table.

```bash
netscli inspect 192.168.1.1 -p 22,80,443
```

Inspect combines:

- Target host and resolved IP.
- Reverse DNS name when available.
- Reachability status and method.
- Optional checked ports and open-port count.
- Raw result data for troubleshooting.

If no ports are supplied, Inspect is a host-only check. If ports are supplied, the port table uses the same status model as `scan`.

## Sweep

Use `sweep` when you want discovery plus exposed service checks across discovered hosts.

```bash
netscli sweep 192.168.1.0/24 -p 22,80,443
```

Sweep is heavier than discovery because it scans ports on each discovered host. It is useful for finding devices with HTTP, SSH, RDP, or other selected services exposed on a local network.

For large ranges or public ranges, prefer a smaller target first. NetsCLI keeps core safety limits, but the responsible target choice is still yours.

## Ping

Use `ping` for a quick reachability and packet-loss summary.

```bash
netscli ping 192.168.1.1 --count 4
```

The result summarizes sent packets, received packets, packet loss, and RTT values. Raw ICMP may require elevated permissions on some platforms; NetsCLI can fall back to TCP-based reachability where appropriate.

## Trace route

Use `trace` to inspect route hops to a host.

```bash
netscli trace 1.1.1.1 --max-hops 30
```

On Windows, NetsCLI uses the platform `tracert` behavior. On Unix-like systems, it uses the available raw-socket path. Some hops may time out because routers often deprioritize or block TTL-expired replies.

## DNS, Reverse DNS, and mDNS

Use `dns` for normal record lookup:

```bash
netscli dns netscli.com --record ALL --json
```

`ALL` asks for the supported record types. Some record families can fail while others succeed. Treat those as partial results unless every lookup fails.

Use `reverse` when you already have an IP address:

```bash
netscli reverse 192.168.1.1
```

Use `mdns` for local multicast DNS service announcements when the build includes mDNS support:

```bash
netscli mdns --timeout-ms 3000
```

mDNS is local-network discovery. It does not query public DNS resolvers.

## Interfaces and ARP

Use `interfaces` to list local network interfaces, addresses, state, MAC address, and loopback or virtual hints:

```bash
netscli interfaces
```

Use `arp` to read the operating system ARP neighbor cache:

```bash
netscli arp
```

ARP is not a full network scan. It shows neighbors your machine already knows about. Run discovery first if you want to encourage the operating system to learn more neighbors.

## Packet capture

Packet capture is optional and requires a build with the `pcap` feature plus libpcap or Npcap at runtime.

```bash
netscli pcap --interface "Eth 2.5G" --duration 5 --max-packets 1000
```

NetsCLI can summarize captured packets into practical rows: number, time, source, destination, protocol, length, and info. It is not a Wireshark replacement, but it gives enough structure to inspect small captures from the CLI or desktop app.
