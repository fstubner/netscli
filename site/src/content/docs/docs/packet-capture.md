---
title: Packet capture
description: NetsCLI packet capture support, runtime requirements, output format, and desktop behavior.
---

Packet capture is optional. It needs a build with packet-capture support and a system packet-capture library.

:::caution[No published build has packet capture]
It is a compile-time feature, and every published artifact — the desktop installers, the standard CLI release assets, and `cargo install netscli` — is built without it. Nothing on this page will work until you install a capture-capable build. See [Packet capture in the install guide](/docs/install/#packet-capture) for the three ways to get one.

Run `netscli doctor` to check which build you have. It works on every build, unlike `netscli pcap --check` below.
:::

## Requirements

<div data-netscli-table="row-headers"></div>

| Platform | Runtime requirement |
| --- | --- |
| Windows | Npcap installed. |
| Linux | libpcap installed and capture permissions granted. |
| macOS | libpcap available and capture permissions granted where required. |

The Packet Capture tool stays visible in the desktop app either way. If the build does not include packet capture support, or support is included but the runtime library or permissions are missing, the tool opens and shows setup guidance instead of running. The rest of the app is unaffected.

## CLI Capture

List available capture devices. This subcommand only exists on capture-capable builds — on a standard build clap reports an unrecognized subcommand, so use `netscli doctor` if you are checking which build you have:

```bash
netscli pcap --check
```

Capture from an interface:

```bash
netscli pcap --interface "Eth 2.5G" --duration 5 --max-packets 1000
```

Parse an existing capture file:

```bash
netscli pcap --read capture.pcap --max-packets 100
```

Important options:

<div data-netscli-table="row-headers"></div>

| Option | Purpose |
| --- | --- |
| `--check` | Check packet-capture support and list capture devices. |
| `--interface` | Capture interface name. |
| `--read` | Parse an existing PCAP file instead of capturing live traffic. |
| `--duration` | Capture duration in seconds. |
| `--max-packets` | Maximum packet count before stopping. |
| `--filter` | Optional capture filter when supported. |
| `--output` | Output file for live captures. |

## Parsed Output

NetsCLI summarizes captured packets into practical rows:

- Number
- Time
- Source
- Destination
- Protocol
- Length
- Info

Details can include parsed Ethernet, IP, TCP, UDP, ICMP, or ARP fields when the packet parser recognizes them, plus a bounded hex preview.

## Desktop Behavior

The desktop app uses a dedicated Packet Capture tab when the feature is available.

Expected workflow:

1. Choose an interface from the available interface list.
2. Set duration, max packet count, and optional filter.
3. Start capture.
4. Review parsed packet rows as the primary result.
5. Inspect selected packet fields and raw preview in the details pane.
6. Open the capture file or containing folder when a file was written.

Save behavior follows the global save settings: default save folder or ask where to save.

## What it is not

NetsCLI packet capture is not a Wireshark replacement. It is intended for quick local inspection, scripting, and lightweight result review. Use Wireshark or tshark for deep protocol dissection, packet coloring rules, stream reassembly, and advanced display filters.

## Troubleshooting

- On Windows, install Npcap if capture fails with a missing `wpcap.dll` or similar runtime error.
- On Linux, confirm libpcap is installed and the user has capture permissions.
- Confirm the selected interface name matches the operating system interface list.
- Start with short captures and simple filters before increasing packet volume.
