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
| Which UDP services answer on this host? | `scan --udp` |
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

<div data-ui-table="row-headers"></div>

| Status | Meaning |
| --- | --- |
| `open` | TCP connect succeeded. NetsCLI may attempt bounded banner, HTTP, or TLS enrichment. |
| `closed` | The host actively refused the TCP connection. |
| `filtered` | The TCP connect attempt timed out or was blocked before connect. |
| `error` | NetsCLI hit an unexpected probe error. |

`filtered` is intentionally technical. It usually means a firewall, router, host policy, or dropped packet prevented a definitive open or closed answer.

### UDP

Add `--udp` to probe UDP instead. With no port list it checks the services
that answer an unauthenticated request on most networks: DNS (53), NTP (123),
NetBIOS (137), SSDP (1900) and mDNS (5353).

```bash
netscli scan 192.168.1.254 --udp
netscli scan 192.168.1.254 --udp -p 53,123
```

UDP has no handshake, so a port only answers a request its service
understands. Each of those ports gets the request its service expects; any
other port you list gets an empty datagram. Ports read as `53/udp`, and the
statuses mean something slightly different:

<div data-ui-table="row-headers"></div>

| Status | Meaning |
| --- | --- |
| `open` | The service replied. The banner says what came back, such as `NTP v4, stratum 2` or the SSDP server string. |
| `closed` | The host answered with an ICMP port-unreachable. |
| `open\|filtered` | No reply and no refusal. The service may be there and ignored the probe, or a firewall dropped it. UDP can't tell those apart. |
| `error` | NetsCLI hit an unexpected probe error. |

UDP scanning needs no administrator rights. SNMP isn't probed: getting an
answer means sending the default community string `public`, which some
networks log as a login attempt.

## Inspect

Use `inspect` when you want a host profile rather than only a port table.

```bash
netscli inspect 192.168.1.1 -p 22,80,443
```

Inspect combines:

- Target host and resolved IP.
- Reverse DNS name when available.
- Reachability status and method.
- MAC address and vendor, for a host on the same network segment.
- An OS hint, with the clues behind it.
- Optional checked ports and open-port count.
- Raw result data for troubleshooting.

If no ports are supplied, Inspect is a host-only check. If ports are supplied, the port table uses the same status model as `scan`.

### OS hint

The OS hint is a best guess from clues the inspection already has, each
listed with where it came from:

```text
OS: Windows 11 or Server 2025 (build 26100) (hint)
    SMB: Windows 10.0 build 26100, name WORKSTATION
    TTL 128
```

<div data-ui-table="row-headers"></div>

| Clue | What it says |
| --- | --- |
| SMB | A Windows host states its exact version, build and computer name at the start of an SMB connection, before any login. Inspect asks port 445 for it whether or not 445 is in your port list; no credentials are sent. |
| SSH banner | OpenSSH usually names the distribution: `Ubuntu`, `Debian`, `Raspbian`, `FreeBSD`, or `for_Windows`. |
| HTTP server | `(Ubuntu)`, `(Debian)` and similar in a `Server` header, or IIS, which only runs on Windows. |
| Open ports | 135 and 445 together are Windows' RPC and file sharing. |
| MAC vendor | An Apple or Raspberry Pi network card. |
| Ping TTL | Hosts start at 64 (Linux, macOS, most Unix), 128 (Windows) or 255 (network equipment). Only Windows reports the TTL today. |

The strongest clue sets the family and the rest are listed under it, including
any that disagree. It is a hint, not a fingerprint: nmap's `-O` sends crafted
packets and needs administrator rights; this needs neither, and a host can
still run anything behind any of these clues.

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

On Windows, NetsCLI runs the platform `tracert` command. On Unix-like systems, it tries `traceroute` and then `tracepath` when available. Some hops may time out because routers often deprioritize or block TTL-expired replies.

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

Use `mdns` for local multicast DNS service announcements:

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

Packet capture is optional and requires a build with packet-capture support plus libpcap or Npcap at runtime.

```bash
netscli pcap --interface "Eth 2.5G" --duration 5 --max-packets 1000
```

NetsCLI can summarize captured packets into practical rows: number, time, source, destination, protocol, length, and info. It is not a Wireshark replacement, but it gives enough structure to inspect small captures from the CLI or desktop app.
