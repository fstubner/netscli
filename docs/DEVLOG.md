# Devlog

Design decisions, debugging notes, and the project as it changes. Ordered
newest-first. Written as I go, so the voice is uneven.

## 2026-04-17 — v0.1.0

### Why it started

I wanted my AI agent to answer questions about my local network. Things
like "what's the IP of the device that just joined", or "is port 22 open
on 192.168.1.42". The existing tools do the job but none of them are nice
to drive from an agent. Half a dozen invocations of `nmap`, `arp`, `dig`,
`ip`, each with different output formats, and no shared state between
calls. An agent ends up parsing ten flavours of text output and guessing.

So I built an MCP server first. `netscli serve` exposes nine tools over
JSON-RPC on stdio and returns structured JSON. Claude Code, Cursor, or
any MCP client can call it and actually get back something usable
without regex-scraping human-formatted output.

That's the original thing. Everything else followed from there.

### Modern terminals as an excuse for the TUI

Once the library existed, I wanted to play with it interactively. A
throwaway REPL would have been enough, but the last year or two of
coding agents (Claude Code, Cursor, Warp) have pushed the bar on
terminal UX a lot. Autocomplete that doesn't interfere with typing.
Command history that survives resizes. In-place progress that doesn't
spam your scrollback. Mouse selection that coexists with keybindings.

I wanted to understand how that's done and where the rough edges are,
so the TUI is built with ratatui and crossterm, renders in the main
buffer (so native scrollback and copy-paste work), and has a slash-
command palette with autocomplete and history. It isn't strictly better
than the CLI for any task; it exists because it's a testbed and because
poking around a network interactively is genuinely nicer than piping
through `jq`.

### CLI output for autonomous calling without MCP overhead

The CLI surface is the simplest and I almost skipped it. Then I realised
that asking someone (or an agent) to spin up a long-running MCP server
just to answer a one-shot question is absurd. `netscli scan host --json`
is the right abstraction for a lot of what an agent or a script wants
to do. No daemon, no handshake, no lifecycle to manage. Pipe the output
into whatever is calling you.

Every non-interactive subcommand supports `--json` and `--yaml`. That
lets an agent call the binary directly with `exec` instead of routing
through MCP, which is a lighter-weight integration for cases where the
shared session state MCP provides isn't needed.

### Desktop GUI for when I don't want a terminal

The desktop app is unapologetically the least novel surface. It exists
because sometimes I just want to click an icon, see what's on my
network, and close it. Opening a terminal and typing `netscli` is more
friction than it sounds when you're not in a coding flow. Tauri 2 gave
me a native window with the same Rust backend calls as every other
surface, so adding it cost a React frontend and a handful of Tauri
commands. The installer ships through the GitHub release matrix.

### One library, four surfaces

`netscli-core` is the thing. `netscli-mcp`, the CLI binary, the TUI
(same binary), and `netscli-gui` all call into it. This sounds obvious
now that it's built, but the split only became clean after two or three
rounds of moving shared logic out of the CLI and into core. Early on
the MCP server duplicated arg parsing and output formatting because it
was faster to ship that way. It bit me within a week. Now `cargo test
-p netscli-core` passing means every surface is correct by construction.

### v0.1.0 publish day: what actually happened

A bunch of small yak-shaves between "first commit" and "crates.io live":

- **Tauri 2 + Linux CI.** `cargo clippy --all-targets` on Ubuntu won't
  link the GUI crate without the GTK/WebKit dev headers. Our first CI
  run died in the lint job before a single test ran. Added
  `libwebkit2gtk-4.1-dev` + friends to both the `lint` and `test`
  jobs' apt install step.

- **crates.io requires a verified email before first publish.** Token
  scopes aren't enough. The publish 400s with a descriptive error,
  which is fine, but it's an easy thing to miss if you don't know.

- **Release workflow didn't trigger on first publish.** Triggered on
  `release: [created]`, which doesn't fire when the release-drafter
  bot creates the draft (GitHub's anti-loop protection), and doesn't
  fire when you manually publish either (that's `[published]`).
  Switched to `[published]` and added `workflow_dispatch` with a tag
  input so this is re-runnable.

- **Npcap SDK zip layout.** The 1.13 archive has `Lib/` and `Include/`
  at the root, not inside a wrapping `npcap-sdk/` folder. I had an
  extra `Join-Path` in the SDK install step that pointed `LIB` at a
  non-existent path. The Windows pcap link failed with `LNK1181: cannot
  open input file 'wpcap.lib'`. Drop the extra path segment, link
  works.

- **ARM64 Linux runner label.** `ubuntu-24.04-arm64` doesn't exist;
  the label is `ubuntu-24.04-arm`. Two of my matrix jobs sat queued
  forever waiting for runners that would never allocate.

- **OUI data wasn't shipping.** `cargo package -p netscli-core`
  didn't include `data/oui.min.json.gz` because it lived at the
  workspace root, outside the crate directory. `cargo install
  netscli` would silently give you empty vendor columns. Copied the
  dataset into `crates/netscli-core/data/`, added it to the crate's
  `include` list, and fell back to `include_bytes!` in the lookup
  chain so it always works. `NETSCLI_OUI_PATH` still overrides.

- **HTTPS cert provisioning is asynchronous.** GitHub Pages took
  several minutes after DNS propagated to issue a Let's Encrypt cert
  for `netscli.com`. The `cname` API field is null until you PUT it
  explicitly, even if `site/CNAME` is deployed.

- **Claude in Chrome sandbox is strict.** Asked the MCP to drive
  Namecheap and Cloudflare; every sensitive domain refused both reads
  and clicks. The agent-controlled browser is reserved for low-trust
  browsing. Sign-in-required sites you do yourself.

### Structure decisions worth keeping

- `crates/` vs `apps/` split. Libraries publish to crates.io; binaries
  consume them. Keeps the public API scoped.
- CLI crate directory is `apps/netscli-cli/` but its package name is
  `netscli`, so users install with `cargo install netscli`.
- `scripts/` has its own Cargo.toml and lockfile. Keeps
  regeneration-script deps out of the main workspace dep graph.
- `site/` lives in-repo with a path-filtered Pages workflow. Docs-only
  changes don't trigger the full Rust CI.
- `rust-toolchain.toml` pins 1.92.0 everywhere for reproducibility.

### What's left for v0.1.1

- `sqlx 0.7` → `0.8` hygiene bump. The CVE in the advisory feed
  (GHSA-xmrp-424f-vfpx) is a PostgreSQL binary protocol issue and we
  only enable the `sqlite` feature, so nothing is reachable, but
  keeping a CVE-flagged version of a direct dep in the tree is noise I
  don't want in the weekly Dependabot email.
- Dependabot PRs on `rollup`, `vite`, `picomatch` still need merging.
  Dev-only deps, but fixing the HIGH advisories now means a smaller
  weekly diff later.
- Per-crate `README.md` for netscli-core and netscli-mcp so crates.io
  pages show more than just the description line.
