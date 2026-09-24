---
title: Compared with other scanners
description: How NetsCLI compares with nmap, Angry IP Scanner and Advanced IP Scanner on platforms, interfaces, discovery, port scanning, DNS, output formats and licence.
head:
  - tag: title
    content: NetsCLI vs nmap, Angry IP Scanner and Advanced IP Scanner
---

This page compares NetsCLI with three well-known network scanners: nmap,
Angry IP Scanner and Advanced IP Scanner. They're good tools, each built for a
different job, and NetsCLI doesn't replace any of them outright. This page
sets out what each one does so you can pick the right one, and says plainly
where another tool is the better choice.

Everything about the other three comes from their own websites,
documentation and source code, checked on 24 September 2026 against the
versions in the first row. If something has changed since, or we've got
something wrong, [open an issue](https://github.com/fstubner/netscli/issues).

## At a glance

<div data-ui-table="row-headers"></div>

| | NetsCLI | nmap | Angry IP Scanner | Advanced IP Scanner |
| --- | --- | --- | --- | --- |
| Version checked | 0.3.3 | 7.991 | 3.10.0 | 2.5.4594.1 |
| Price | Free | Free | Free | Free |
| Licence | MIT, open source | Nmap Public Source License; source available | GPLv2, open source | No source code published |
| Windows | ✓ | ✓ | ✓ | ✓ (7 to 11) |
| macOS | ✓ | ✓ | ✓ | – |
| Linux | ✓ | ✓ | ✓ | – |
| Command line | ✓ | ✓ | ✓ | Console version, options not documented |
| Full-screen terminal UI | ✓ | – | – | – |
| Desktop app | ✓ | ✓ (Zenmap) | ✓ | ✓ |
| MCP server for AI agents | ✓ | – | – | – |
| Host discovery | ICMP or TCP probe, plus the ARP table | ARP on a local network by default; ICMP, TCP, UDP, SCTP and IP-protocol pings | ICMP, UDP, TCP or combined, plus ARP on a local network | Not documented |
| MAC address and vendor | ✓ | ✓ | ✓ | ✓ |
| TCP port scan | ✓ (connect scan) | ✓ (SYN, connect and many other types) | ✓ (connect scan) | Checks for HTTP, HTTPS, FTP, RDP, Radmin and shared folders; port scanning is a separate Famatech tool |
| UDP port scan | – | ✓ | – | – |
| Service versions and OS detection | – | ✓ | – | – |
| What it reads from open ports | Banners, HTTP headers, TLS details | Service and version, via probes and scripts | Web server header, NetBIOS info | NetBIOS name and group |
| Scripting or plugins | – | ✓ (NSE, over 600 Lua scripts) | ✓ (Java plugins) | – |
| DNS lookups | Any common record type: A, AAAA, CNAME, MX, NS, TXT, SRV, SOA, CAA, PTR | Resolves targets and reverse DNS; some record types through NSE scripts | Reverse DNS, with mDNS and NetBIOS fallback | – |
| mDNS / DNS-SD discovery | ✓ | Through an NSE script | Hostname fallback only | – |
| Traceroute | ✓ (runs the system's traceroute and returns the hops as data) | ✓ (`--traceroute`) | Opens the system's traceroute | Opens Windows `tracert` |
| View and edit the ARP table | ✓ | – | – | – |
| Packet capture | ✓ (separate `-pcap` builds, needs Npcap or libpcap) | – | – | – |
| Remote management | – | – | Opens external tools for a host | ✓ (RDP, Radmin, remote shutdown, Wake-on-LAN, shared folders) |
| Output formats | JSON and YAML from the CLI; JSON and CSV from the desktop app; Markdown and JSON from the TUI | Normal, XML, grepable; no JSON | TXT, CSV, XML, IP:port list, SQL | CSV, XML, HTML |
| Official package managers | winget, Scoop, Homebrew, AUR, npm, cargo | Linux distributions, MacPorts, Fink | – (installers, .deb, .rpm) | – (installer, with a portable option) |

✓ available · – not offered, as far as that tool's own documentation and source
show

## When to use which

### nmap

Use nmap when you need depth. It does SYN and UDP scans, identifies service
versions and operating systems, runs over 600 scripts for discovery and
vulnerability checks, and scales to very large networks. NetsCLI does none of
those things and isn't trying to. If you're auditing a network or doing
security work, nmap is the tool.

The trade-offs are that most of its scan types need administrator or root
rights, it has no JSON output, and on Windows it needs the Npcap driver, which
its installer includes.

### Angry IP Scanner

Use Angry IP Scanner for a quick point-and-click sweep of a range, on any
desktop operating system. It pings every address, reads hostnames, MAC
addresses and open ports, and exports to CSV, XML or text. Java plugins can
add new columns or pingers. It needs Java 21 or later, which the Windows
installer and the macOS app bundle for you.

### Advanced IP Scanner

Use Advanced IP Scanner if you're a Windows admin who wants to act on what the
scan finds. From the results you can open RDP or Radmin sessions, browse
shared folders, shut a machine down remotely or wake it with Wake-on-LAN. It
runs on Windows only, and its documentation covers checks for specific
services rather than port scanning; for that, Famatech offers Advanced Port
Scanner.

### NetsCLI

Use NetsCLI when you want the same scan in more than one place: a terminal UI
for interactive work, a CLI whose `--json` output a script can parse, a
desktop app for sorting and filtering results, and an MCP server so an AI
agent can run the scans itself. Host discovery, port scans, DNS record
lookups, mDNS, traceroute and the ARP table all live in one tool, and all four
interfaces run on the same Rust core.

NetsCLI doesn't need administrator rights for discovery or port scans. It is
MIT-licensed and installs through winget, Scoop, Homebrew, the AUR and npm.
See [Interface coverage](/docs/interface-coverage/) for exactly what each
interface offers, and [Installation](/docs/install/) to get started.

## Sources

- nmap: [download page](https://nmap.org/download.html),
  [changelog](https://nmap.org/changelog.html),
  [reference guide](https://nmap.org/book/man.html),
  [NSE scripts](https://nmap.org/nsedoc/),
  [licence](https://nmap.org/npsl/).
- Angry IP Scanner: [website](https://angryip.org/),
  [download page](https://angryip.org/download/),
  [3.10.0 release](https://github.com/angryip/ipscan/releases/tag/3.10.0),
  [source code](https://github.com/angryip/ipscan).
- Advanced IP Scanner: [website](https://www.advanced-ip-scanner.com/),
  [download page](https://www.advanced-ip-scanner.com/download/),
  [help](https://www.advanced-ip-scanner.com/help/).
