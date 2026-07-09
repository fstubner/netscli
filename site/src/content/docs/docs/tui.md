---
title: Terminal UI
description: NetsCLI terminal UI guide for keyboard-first network diagnostics.
---

The terminal UI is for interactive, keyboard-first diagnostics inside a terminal. It uses the same core operations as the CLI, desktop app, and MCP server.

## When to use it

Use the TUI when:

- You want an interactive session but prefer terminal workflows.
- You are connected to a server or workstation without a desktop shell.
- You want command history, autocomplete, and readable summaries in one screen.
- You are iterating on targets and ports by hand.

Use the CLI when a script needs JSON/YAML. Use the desktop app when you need richer tables, filtering, multi-tab review, or row details.

## Start the TUI

```bash
netscli
```

The TUI starts without a subcommand. From there, type commands in the input area.

## Command entry

Common interactive commands mirror the CLI operations:

```text
/discover 192.168.1.0/24
/scan 192.168.1.1 -p 22,80,443
/sweep 192.168.1.0/24 22,80,443
/dns netscli.com
/reverse 192.168.1.1
/mdns --timeout 3000
/interfaces
```

Use `/help` and completion to discover the available options. The TUI also includes `/config` for terminal-session settings and `/export` for saving the current session output.

## Session behavior

The TUI is designed for investigation sessions:

- Command history stays close to the current result.
- Status colors highlight open ports, filtered ports, host state, and errors.
- Local interface and traffic status remain visible while you work.
- `/export md` or `/export json` can preserve useful investigation output.

## Output model

The TUI favors readable summaries over exhaustive machine-readable structures. If you need stable structured output, run the same operation through the CLI with `--json` or `--yaml`.

## Limitations

Terminal rendering depends on the terminal emulator and font. Wide tables, long IPv6 addresses, and long DNS names may wrap or truncate more aggressively than in the desktop app.
