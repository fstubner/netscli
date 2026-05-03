# Changelog

All notable changes to netscli are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Workspace crates (`netscli`, `netscli-core`, `netscli-mcp`) share a
version and release together.

## [Unreleased]

## [0.2.4] — 2026-05-03

### Fixed
- **GUI bundle path** in release.yml's GUI matrix was rooted at
  `apps/netscli-gui/src-tauri/target/${TARGET}/release/bundle/`. Cargo
  workspaces actually use the **workspace-root** `target/` directory
  regardless of which subcrate's directory cargo was invoked from, so
  Tauri's bundle output lives at `target/${TARGET}/release/bundle/`.
  v0.2.3 built the `.deb` / `.dmg` / `.msi` correctly but the collect
  step found an empty bundle dir and skipped everything; sigstore-sign
  then failed trying to sign nothing.
- **AUR deploy action** (`KSXGitHub/github-actions-deploy-aur`) was
  pinned to `@v2.7.0` (April 2024), which has a `bash: --command:
  invalid option` regression in its container entrypoint. Bumped to
  `@v4.1.3` (current stable, same input shape).

### Notes on v0.2.3
- CLI release shipped: 44 assets, sigstore-signed, on the v0.2.3
  release page.
- Homebrew, Scoop, Winget, and crates.io all updated to 0.2.3.
- AUR is still on the previous version (failed to push).
- 0 GUI installers attached to v0.2.3 release.

## [0.2.3] — 2026-05-03

### Fixed
- **Tauri version skew** broke all 4 GUI installer builds in v0.2.2's
  release matrix. The Cargo.toml constraint `tauri = "2.0.0"` resolved
  to `tauri 2.9.5`, but npm `@tauri-apps/api: ^2` resolved to `2.10.1`.
  Tauri's CLI rejects same-major different-minor as a version
  mismatch. Loosened the Rust constraint to `tauri = "2"` and ran
  `npm update --save` so both sides land on the same minor (currently
  `2.11.0`). Verified with a local `npm run tauri build` producing
  `NetsCLI_0.2.3_x64_en-US.msi` cleanly.
- **AUR publish job in publish.yml** failed on v0.2.2 with a confusing
  `bash: --command: invalid option` error from the deploy action's
  internals. Root cause: rendered PKGBUILD was written to `/tmp/
  PKGBUILD`, but the `KSXGitHub/github-actions-deploy-aur` action runs
  in a Docker container that only mounts `$GITHUB_WORKSPACE` — files
  in `/tmp` are invisible inside the container. Render now writes to
  `packaging/aur/PKGBUILD` (workspace-relative) before handoff.

### Notes on v0.2.2
- CLI binaries shipped successfully on v0.2.2 — `cargo install`,
  `brew install netscli`, and `scoop install netscli` all give v0.2.2.
- v0.2.2 GitHub release has CLI assets but no GUI installers.
- AUR `netscli-bin` was last bumped to v0.2.0; it'll catch up to
  v0.2.3 directly.

## [0.2.2] — 2026-05-03

### Fixed
- Cargo.lock was out of sync with Cargo.toml at the v0.2.1 tag —
  `tokio 1.52.1` (bumped in #17) requires `socket2 >= 0.6.3`
  transitively, but Dependabot only regenerated the direct-dep entries
  in the lock. CI's lint paths use `cargo build` (no `--locked`) so
  this slipped through; release.yml uses `--locked` to guarantee
  reproducible builds, and all 17 release builds for v0.2.1 failed at
  the lockfile check.
- 0.2.2 regenerates the lockfile so `socket2 0.6.3` is recorded
  alongside the existing `0.5.10`. No application code changes.

### Notes on v0.2.1
- Released to crates.io but the GitHub release page has no attached
  binaries (release.yml never produced any). `cargo install netscli`
  works because cargo regenerates the lockfile per-user; downloads
  from the GitHub release / package managers should use 0.2.2.
- 0.2.1 is left in place as crates.io history rather than yanked.

## [0.2.1] — 2026-04-30

### Added
- Prebuilt desktop GUI installers attached to every release: `.msi`
  (Windows x86_64), `.dmg` (macOS aarch64 + x86_64), `.deb` and
  `.AppImage` (Linux x86_64). Each is sigstore-signed alongside the
  CLI binaries. macOS `.dmg` ships unsigned for now; right-click →
  Open to bypass Gatekeeper, or run
  `xattr -dr com.apple.quarantine /Applications/NetsCLI.app`.
- `--concurrency <N>` (alias `-j <N>`) global CLI flag for tuning
  in-flight network operations. Default stays at 256; clamped to
  [1, 1024]. Useful on fragile home gateways that can't keep up with
  hundreds of simultaneous probes.

### Changed
- Bumped `pnet_packet`, `pnet_transport`, `pnet_datalink`, and
  `pnet_sys` from 0.34 to 0.35.
- Bumped `sysinfo` from 0.30 to 0.38. New `Networks::refresh(true)`
  semantics drop hot-unplugged interfaces from the cached map rather
  than retaining stale RX/TX stats.

### Notes
- `ipnetwork` stayed at 0.20 because `pnet_datalink 0.35` still pins
  it transitively; will revisit when upstream pnet relaxes the
  constraint.

## [0.2.0] — 2026-04-18

### Added
- `netscli completions <bash|zsh|fish|powershell|elvish>` subcommand that
  writes a shell-completion script to stdout. Package managers
  regenerate completions at install time by shelling out to the
  installed binary, so they never drift from the CLI surface.
- `netscli man` subcommand that renders the roff-format man page from
  the clap command tree to stdout.
- Sigstore keyless signing in `.github/workflows/release.yml`. Every
  release asset now ships with a `.sig` + `.pem` alongside the `.sha256`,
  verifiable by anyone with `cosign verify-blob`. No paid cert, no
  long-lived secrets; uses the GitHub Actions OIDC token exchanged via
  Fulcio for a short-lived signing cert bound to the workflow + commit +
  tag.
- `packaging/` directory with submission templates for Homebrew (tap),
  Scoop (bucket), Winget (microsoft/winget-pkgs via wingetcreate), and
  Arch AUR (`netscli-bin`). Each has a README with the submission flow
  and VERSION_SHA256_* placeholders that get stamped with real
  checksums on release day.
- **mDNS / DNS-SD service discovery.** New `netscli-core::mdns` module
  (behind the `mdns` feature) with `MdnsEngine::discover` and
  `discover_common` on top of the pure-Rust `mdns-sd` crate. Browses a
  curated set of service types (`_http._tcp`, `_ssh._tcp`,
  `_airplay._tcp`, `_googlecast._tcp`, `_ipp._tcp`, …) in parallel and
  returns devices with hostname, resolved IPv4/IPv6 addresses, port,
  service type, and full TXT record properties.
- New CLI subcommand `netscli mdns [--timeout-ms N] [-t <service_type>]`
  with text, JSON, and YAML output. Text output is device-centric:
  one block per hostname with its addresses and announced services.
- New TUI slash command `/mdns [--timeout <ms>]`.
- New MCP tool `discover_mdns` accepting `timeout_ms` (default 3000,
  clamped 100–30000) and optional `service_types`. Returns the same
  structured payload as the CLI `--json`, so agents can filter by
  model (`properties.md`), friendly name (`properties.fn`), or service
  type without an extra pass through text output.
- The `netscli` binary and the `netscli-mcp` default feature both
  include `mdns` so the capability ships by default in published
  artifacts.
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
- Extracted section headings + leads into `site.copy` so the landing
  page is 100% data-driven; no per-project strings in components.

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

[Unreleased]: https://github.com/fstubner/netscli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fstubner/netscli/releases/tag/v0.2.0
[0.1.1]: https://github.com/fstubner/netscli/releases/tag/v0.1.1
[0.1.0]: https://github.com/fstubner/netscli/releases/tag/v0.1.0
