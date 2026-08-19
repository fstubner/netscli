---
title: Desktop app
description: NetsCLI Desktop guide for tabs, filters, details, history, settings, exports, and command previews.
---

NetsCLI Desktop is the interactive interface for reviewing network results. It is built for users who want tables, filters, row details, history, exports, and multiple operation tabs open at once.

## When to use the desktop app

Use the desktop app when:

- You want to compare results across multiple tabs.
- You want sortable and filterable tables.
- You need row details, raw JSON, or selected-row summaries.
- You want to export JSON, CSV, or a reusable NetsCLI result bundle.
- You prefer a desktop interface but still want to see the equivalent CLI command.

Use the CLI instead when you need setup, doctor, shell completions, manpages, service management, or scripts that run unattended.

## Shell layout

| Area | Purpose |
| --- | --- |
| Menu bar | File, Edit, Scan, Tools, History, Settings, and Help actions. |
| Toolbar | Run, cancel, export, and operation-level actions for the active tab. |
| Tab strip | Keeps scans, lookups, route checks, inventory views, and captures side by side. |
| Filter bar | Plain text and token filtering for the active result set. |
| Result table | Sortable, selectable rows for the active operation. |
| Details pane | Operation-specific details, raw JSON, selected-row summaries, and parsed packet data. |
| Command bar | Optional CLI equivalent for the active operation. |
| Status bar | Selected interface, traffic activity, operation state, and result counts. |

## Operation tabs

Tabs show the operation name and a short identifier such as host, subnet, interface, or record name. They do not show the full command; the command preview lives in the command bar.

Supported operations include:

- Port Scan
- Ping
- Trace route
- Discover
- Inspect
- Sweep
- DNS Lookup
- Reverse DNS
- mDNS Discovery
- Interfaces
- ARP Table
- Packet Capture, which is always listed but only runs on a capture-enabled build

## Filters

The filter bar accepts plain text and field tokens. Tokens are generated from the active result set, so hints reflect the current tab rather than hard-coded examples.

Examples:

```text
status:open
port:443
vendor:"TP-Link Systems Inc"
type:A
```

Prefix a token with `-` to exclude matches:

```text
-status:filtered
```

## Tables and selection

Tables support sorting and keyboard selection. Multi-select is useful when copying selected rows or exporting only part of a result set.

The details pane changes when multiple rows are selected. Instead of duplicating the full table, it summarizes the selection and shows the most useful selected values for that operation.

## Details pane

The details pane is operation-specific:

- Scan rows explain open, closed, filtered, and error states.
- Inspect shows a host overview, checked ports, and raw data.
- Discover and Sweep summarize device inventory and exposed services.
- DNS shows record values and metadata such as TTL or resolver source when available.
- Interfaces shows state, addresses, MAC, selected/default hints, and loopback or virtual hints.
- ARP identifies local neighbor cache entries rather than full network discovery.
- Packet Capture shows parsed packet fields and a bounded hex preview.

The pane can be collapsed, resized, or expanded to fill the content area.

## History and exports

History records recent operations so you can reopen or repeat work. If history persistence is enabled, command history and result snapshots survive app restarts.

Export options:

- JSON for structured data.
- CSV for tabular use in spreadsheets.
- NetsCLI result bundle when you want to reopen the result in the desktop app later.

Save behavior is controlled in Settings. You can use the default save folder or ask where to save each time.

## Settings

Settings control:

- Theme.
- CLI command bar visibility.
- Toast and operation notifications.
- Release notifications.
- Maximum concurrent probes for scan, discover, and sweep operations.
- History persistence.
- Default save folder and ask-before-save behavior.
- Network interface used for local status indicators.
- Address family preference for the selected interface display.
- Traffic unit and precision display.

## Build and runtime availability

Most desktop tools are available in the standard desktop build. Packet capture is handled explicitly:

- Packet Capture stays in the tool list in every build. Running a capture needs a build that includes packet-capture support, plus Npcap on Windows or libpcap on Linux/macOS. Without those, the tab opens and shows setup guidance instead of running.
- mDNS Discovery is included in the standard published desktop build.
- A tool whose feature is genuinely absent from the build is hidden. That applies to mDNS Discovery; Packet Capture is the deliberate exception, because the published installers ship without it and a hidden tab explained nothing.
- If a required runtime library is missing, only that feature is unavailable. The rest of the desktop app keeps working and shows setup guidance for the missing dependency.
