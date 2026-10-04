---
title: Privacy
description: What NetsCLI collects, what stays on your computer, and the few things that reach the internet.
---

NetsCLI has no accounts, no advertising and no telemetry. Nothing you scan is sent to the developer or to anyone else.

## What stays on your computer

NetsCLI reads information about your local network to do its job. That includes IP addresses, MAC addresses and the maker they belong to, hostnames, open ports, and the greetings services send back. It is shown to you and is not uploaded anywhere.

Some of it is kept on your computer.

- The desktop app can keep your 20 most recent runs, with their results, so you can reopen them. Clearing history removes them.
- The desktop app and terminal UI remember their settings.
- Exports and packet captures are written only where you choose to save them.

## What reaches the internet

- **Scans go where you point them.** A port scan, ping, trace or DNS lookup contacts the hosts and DNS servers you ask it to, the same as any network tool.
- **The desktop app checks for new releases.** It asks GitHub's API for the latest NetsCLI release, which shares your IP address with GitHub. You can turn the check off in Preferences. If you choose to install an update, it is downloaded from GitHub Releases.
- **The command line, terminal UI and MCP server** make no connections of their own beyond the operations you run.

## This website

netscli.com is hosted on GitHub Pages and uses Cloudflare Web Analytics, which counts page views without cookies and without identifying visitors. The landing page asks GitHub and crates.io for the star and download counts it shows, so your browser contacts both.

## Contact

Questions about privacy can go to the [issue tracker](https://github.com/fstubner/netscli/issues).
