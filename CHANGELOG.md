# Changelog

All notable changes to netscli are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Workspace crates (`netscli`, `netscli-core`, `netscli-mcp`) share a
version and release together.

## [Unreleased]

### Added
- `netscli_core::Error` typed-error enum and `netscli_core::Result<T>`
  alias. Library consumers can now pattern-match on
  `InvalidInput` / `Dns` / `Network` / `Timeout` / `Unsupported` / `Io`
  / `Database` / `Pcap` / `Other` instead of passing around an opaque
  `anyhow::Error`. The enum is `#[non_exhaustive]` so new variants
  can land without being breaking changes.
- `netscli-core` feature `db` gating the SQLite `Database` type (and
  its sqlx + chrono deps). Default build is ~35% smaller transitive
  crate graph (256 → 167). The `netscli` binary opts in to `db`;
  library consumers can stay lean with `default-features = false`.
- `cargo-audit` CI workflow (`.github/workflows/audit.yml`) running on
  push / PR / weekly schedule, with a documented `.cargo/audit.toml`
  ignore list for transitive advisories that aren't reachable under
  our feature set.

### Changed
- **All public functions** in `netscli-core` now return
  `netscli_core::Result<T>` with structured error variants instead of
  `anyhow::Result<T>`. Covers: `common::parse_ports*`, the full `dns`
  module, the `Ops` surface, `InspectEngine`, `SweepEngine`,
  `NetworkManager::{get_arp_table, add_entry, delete_entry, clear_table}`,
  `PcapEngine`, and `Database`.
- `Error` variant mapping by module:
  - `common`, `ops` subnet/record parsing → `InvalidInput`
  - `dns` resolver failures → `Dns`; timeouts → `Timeout(ms)`
  - `ops::resolve_host_ip_with_timeout` unresolved host → `Dns`
  - `pcap` unsupported (build-time or no interfaces) → `Unsupported`
  - `arp` process-exec failures and permissioned ops → `Other` (with
    the permission hint in the message; a dedicated `PermissionDenied`
    variant may land later)
  - `Database` (sqlx) errors → `Database` variant via `#[from]`
  - `pcap` runtime errors → `Pcap` variant via `#[from]`
- A few private helpers in `ping.rs` (ICMP round-trip internals) keep
  `anyhow::Error` because they never reach the public surface.

## [0.1.1] — 2026-04-17

### Added
- Per-crate `README.md` for `netscli-core`, `netscli-mcp`, and
  `netscli` so their crates.io pages have real content rather than
  just the one-line description.
- `CHANGELOG.md`, `SECURITY.md`, and `docs/DEVLOG.md`.
- `.github/dependabot.yml` replacing the inherited default. Groups
  patch/minor bumps, keeps first-tier deps (tauri, sqlx, tokio,
  hickory) as individual PRs, gives the frontend bundler stack its
  own grouped PR.

### Changed
- Bumped `sqlx` dep in `netscli-core` from 0.7 to 0.8. No source
  changes needed; our usage is entirely `query()` / `query_as::<_, T>()`
  / `FromRow`, and the 0.8 breaking changes affected other paths. This
  drops GHSA-xmrp-424f-vfpx from the advisory noise even though it was
  never reachable with our `sqlite`-only feature set.
- Consolidated the OUI vendor dataset under
  `crates/netscli-core/data/oui.min.json.gz`. It used to live at the
  workspace root and wasn't bundled in the published crate.
- Reorganised `docs/` into `docs/screenshots/` and `docs/assets/`.
- `README.md`: primary install instruction is now
  `cargo install netscli` (was git-URL form). crates.io / Release /
  Downloads badges are live.

### Fixed
- Release build workflow now triggers on `release: [published]` and
  supports `workflow_dispatch` with a tag input. Previously it listened
  on `[created]`, which GitHub's anti-loop protection suppresses when
  release-drafter creates the draft, so no platform binaries were ever
  built automatically for v0.1.0.
- Npcap SDK install step in the release workflow was pointing `LIB` at
  the wrong path (the 1.13 zip has `Lib/` at its root, no wrapping
  `npcap-sdk/` folder). Windows pcap variant now builds.
- `ubuntu-24.04-arm64` runner label corrected to `ubuntu-24.04-arm`;
  the ARM64 Linux matrix jobs no longer queue forever.

### Security
- Dropped CVE-flagged dep versions from the tree through transitive
  patches (`bytes`, `time`, `rand`, `rsa`) and the `sqlx` major bump.
  None of the CVEs were reachable under our feature flags, but
  keeping flagged versions around cluttered the alert feed.

## [0.1.0] — 2026-04-17

First public release. CLI, TUI, desktop GUI, and MCP server all
backed by the same core library.

### Added
- `netscli-core` — host discovery, port scan, DNS lookup (all record
  types), reverse DNS, ARP with vendor resolution, network sweep,
  ping, traceroute, interface listing, optional libpcap packet
  capture. OUI vendor DB ships embedded in the crate.
- `netscli-mcp` — JSON-RPC MCP server exposing nine tools over stdio
  for Claude Code / Cursor / any MCP client.
- `netscli` — CLI + ratatui TUI. `netscli <cmd>` for scripts,
  `netscli` alone for the interactive TUI, `netscli serve` for the
  MCP server.
- `netscli-gui` — Tauri 2 + React 19 desktop app with dashboard,
  scan, DNS, interfaces, and settings views.
- `--json` / `--yaml` structured output on every non-interactive
  subcommand.
- Release binaries for Windows x86_64, Linux x86_64/aarch64 (glibc)
  and x86_64 (musl), macOS x86_64/aarch64, each with and without
  pcap.
- GitHub Pages landing at https://netscli.com with Cloudflare Web
  Analytics.
- Install scripts (`install.sh`, `install.ps1`) with optional
  `NETSCLI_PCAP=1` flag that downloads the pcap variant and installs
  the platform's packet-capture library.

### Known limitations
- `sqlx 0.7` in the `netscli-core` dep tree surfaces a PostgreSQL
  binary protocol advisory (GHSA-xmrp-424f-vfpx). Not reachable since
  only the `sqlite` feature is enabled. Planned hygiene bump to
  `sqlx 0.8` in v0.1.1.
- Desktop app needs the WebView2 runtime on Windows. Most Windows
  10/11 systems have it preinstalled.

[Unreleased]: https://github.com/fstubner/netscli/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/fstubner/netscli/releases/tag/v0.1.1
[0.1.0]: https://github.com/fstubner/netscli/releases/tag/v0.1.0
