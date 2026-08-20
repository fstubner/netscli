# Changelog

All notable changes to netscli are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Workspace crates (`netscli`, `netscli-core`, `netscli-mcp`) and the
desktop app are released together under one version number. Note that
they do not *inherit* it — each crate sets its own, and the GUI carries
further copies in `package.json` and `tauri.conf.json`. See
`docs/PUBLISHING.md` for the full list of files a bump has to touch.

## [Unreleased]

## [0.3.0] — 2026-08-20

### Added

- **Richer port scan results across every interface.** Port scans now
  report additive status and detail fields (`open`, `closed`,
  `filtered`, `error`, latency, banners, HTTP metadata, TLS metadata,
  and raw previews where available) while keeping the older `open`,
  `port`, `service`, and `error` fields intact for compatibility.
- **GUI render automation.** The desktop app now has Tauri/WebDriver
  render coverage for the diagnostic workspace, including tab layout,
  top menus, toolbar actions, filtering, row selection, detail panes,
  command preview, and status bar behavior.
- **User-configurable probe concurrency.** The CLI and MCP server already
  accepted concurrency limits; the desktop app settings and TUI settings
  now expose the same control so users can reduce simultaneous probes on
  fragile networks or raise them within the core safety cap.
- **Address-family display preference in the desktop app.** The status bar
  now prefers IPv4 by default and lets users choose IPv6-first display when
  that better matches their environment.

### Changed

- **Desktop app redesigned around a denser diagnostic workspace.**
  NetsCLI Desktop moved from the earlier dashboard-style UI to a
  native-like shell with operation tabs, compact forms, sortable and
  filterable results, row details, CLI command previews, and status
  summaries. The GUI continues to use the same `netscli-core`
  operations as the CLI, TUI, and MCP server, so desktop behavior stays
  aligned with the rest of the tool.
- **Desktop app icon refreshed to match the current brand.** The Tauri
  icon generator now renders the ANSI-style `N` using the same gradient
  direction as the website/favicon, and regenerates the Windows/Tauri
  icon assets from that source.
- **CLI and TUI scan output now reflects richer status data.** Human
  output stays concise, but scanned ports can show closed, filtered, and
  error states with latency where available instead of only emphasizing
  open ports.
- **Windows install guidance now prefers Winget for the desktop app.**
  Release notes and install docs call out Winget's manifest review and
  installer hash verification as the recommended Windows path, while direct
  GitHub Windows installers remain unsigned and may show Windows warnings
  until code signing is added later.
- **Website, docs, FAQ, 404 page, and changelog refreshed for the new
  release.** The public site now uses a more consistent shell, unified code
  and table styling, clearer search behavior, release-note summaries, and
  a desktop-app screenshot captured from the real UI with representative
  demo data.
- **Linux/macOS install docs clarified.** mDNS is documented as the default
  pure-Rust capability in published builds, while packet capture remains
  the optional workflow that depends on libpcap/Npcap support.
- **Website rebuilt for every screen width.** The landing page and docs were
  swept across six widths and both themes, and the shell, navigation, contents
  list, colour and typography were reworked to hold up at all of them. The
  brand accent moved from a teal-green that read blue in small text to one that
  reads green at any size, and contrast improved with it.
  ([#190](https://github.com/fstubner/netscli/pull/190)–[#209](https://github.com/fstubner/netscli/pull/209))
- **Search, head metadata and page titles rewritten** so the site describes
  what it is rather than repeating adjectives.
  ([#204](https://github.com/fstubner/netscli/pull/204))
- **Per-PR site previews on Cloudflare Pages**, and GitHub Pages deploys are
  manual-only. ([#165](https://github.com/fstubner/netscli/pull/165),
  [#136](https://github.com/fstubner/netscli/pull/136))

- **`netscli scan --json` now reports every port, not just the open ones.**
  Filtering to open ports made "all closed", "all filtered" and "every
  probe errored" the same empty array, so a script could not tell a clean
  scan from a host that refused every probe. Each entry carries `open` and
  `status`, so callers that want only open ports can filter for them.
- **The MCP server now scans only local networks by default.** This is the
  one surface driven by a model rather than by the person at the keyboard,
  so the instruction to scan a third party can arrive from a web page or a
  file someone else wrote — and the packets leave from your machine and
  your IP. RFC1918, loopback, link-local and the carrier-grade NAT range
  overlay networks use are allowed; set `NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1`
  to reach past them.
- **Scan results returned to a model are capped.** The full probe response
  (`raw`) is no longer included and banners are truncated, both being bytes
  chosen by the scanned host.
- **Tool failures are returned as MCP `isError` results** rather than
  JSON-RPC errors, so a failed scan no longer reads to a client as a broken
  server.
- **The desktop app's CSV export escapes spreadsheet formulas.** A cell
  beginning `=` `+` `-` or `@` is evaluated on open by Excel and
  LibreOffice, and exported cells carry banners and hostnames the scanned
  host chose. Values that parse as numbers are untouched, so a negative
  latency is still a number.

### Changed (internal)

- **GUI architecture split into maintainable ownership modules.**
  `App.tsx` and the old single CSS file were decomposed into workspace
  state, tool presentation helpers, shell components, result/detail
  components, Tauri services, and layered style files. The UI behavior
  stays production-data driven; no mock/sample data is shipped in the
  app.
- **Core, CLI, TUI, MCP, and Tauri internals reduced from monolithic
  files into facades plus focused modules.** The public Rust API, CLI
  syntax, MCP schema, Tauri command payloads, GUI data shape, and SQLite
  schema remain stable.
- **CI tightened for future changes.** PR CI now includes GUI unit tests
  before the GUI build, and a separate Tauri render workflow can run
  manually, nightly, or on GUI/Tauri-related pull requests.
- **Packaging templates and release workflows audited.** Release workflows
  use the pinned Rust toolchain, AUR templates include runtime dependencies
  and license installation, Winget/Scoop/Homebrew reference manifests were
  refreshed, and packaging validation commands were added to the release
  checklist.
- **CI gates report unconditionally**, so branch protection can require them,
  and both required checks were closed against a job that fails without
  failing the gate. ([#161](https://github.com/fstubner/netscli/pull/161),
  [#187](https://github.com/fstubner/netscli/pull/187))
- **The end-to-end suite can now fail.** Several scenarios were structurally
  incapable of it. ([#199](https://github.com/fstubner/netscli/pull/199))
- **The Tauri render suite is schedule-only** and no longer gates releases.
  ([#178](https://github.com/fstubner/netscli/pull/178))
- **A dead-CSS budget runs in CI**, holding the docs override stack at its
  current 126 provably shadowed declarations.
  ([#207](https://github.com/fstubner/netscli/pull/207))
- **Node 22, jsdom 30, ESLint 10, react-hooks 7**, and three Rust dependency
  bumps. ([#187](https://github.com/fstubner/netscli/pull/187)–[#189](https://github.com/fstubner/netscli/pull/189))
- **Release pipeline hardened**: tag validation on the AUR jobs, a checksum
  that could be contaminated by progress output, and the publish long tail.
  ([#158](https://github.com/fstubner/netscli/pull/158),
  [#200](https://github.com/fstubner/netscli/pull/200))

### Fixed

- **MCP server handled one request at a time.** The read loop awaited each
  handler before parsing the next line, so a slow scan blocked every other
  request on the connection, including cancellation. Handlers now run
  concurrently under a semaphore. ([#169](https://github.com/fstubner/netscli/pull/169))
- **Reading the ARP table blocked a runtime worker.** On Windows and macOS it
  shells out to `arp` and waits on the child process; three callers invoked it
  straight from async code. With MCP handlers capped at 16 concurrent, sixteen
  of these could stall every worker — including the one reading stdin, so no
  further request could even be parsed. Moved to a blocking thread.
  ([#196](https://github.com/fstubner/netscli/pull/196))
- **Safety limits were enforced in `Ops` but not in the engines.** The scan,
  sweep, discover and inspect engines are public API re-exported at the crate
  root, and called directly they applied no subnet, port or concurrency cap —
  `0.0.0.0/0` collected 4,294,967,294 addresses into a `Vec` before sending a
  packet. Every engine now enforces its own limits.
  ([#198](https://github.com/fstubner/netscli/pull/198))
- **Port 0 was rejected only by the MCP surface.** Now rejected everywhere.
  ([#164](https://github.com/fstubner/netscli/pull/164))
- **Panic paths in the core and silent corruption in the OUI generator.**
  ([#172](https://github.com/fstubner/netscli/pull/172))
- **TUI mis-measured wide characters**, so CJK and emoji in a remote-supplied
  hostname or banner pushed box borders out of alignment.
  ([#173](https://github.com/fstubner/netscli/pull/173))
- **The desktop app described work it had not done.** The command preview
  claimed five ports while three were scanned, truncated captures were
  presented as complete, and the open-port count drifted from the rows below
  it. ([#197](https://github.com/fstubner/netscli/pull/197))
- **Packet Capture vanished on builds without capture support** instead of
  explaining what was needed. ([#193](https://github.com/fstubner/netscli/pull/193))
- **The desktop app was not keyboard operable**, and the result grid had
  incorrect ARIA. ([#171](https://github.com/fstubner/netscli/pull/171))
- **The website claimed packet capture in builds that do not ship it**, and
  advertised a version that was never released.
  ([#194](https://github.com/fstubner/netscli/pull/194),
  [#208](https://github.com/fstubner/netscli/pull/208))

- **Safety limits that only one caller was applying.** `SweepEngine::sweep`
  validates its port list instead of trusting the caller and silently
  returning "no open ports"; mDNS browse duration, `ping -c` and packet
  captures given a packet count but no duration all gained the core-side
  ceiling they were documented to have.
- **`netscli trace` no longer prints router-supplied hostnames unsanitised.**
  Hop names come from PTR records controlled by whoever runs those routers,
  and this was the last plain-text output path without the terminal-safety
  pass every other one had.
- **Four ways an MCP client could wedge or kill the server**: no overall
  request deadline, permits acquired after spawning rather than before, a
  single invalid UTF-8 byte on stdin terminating the process, and client
  disconnect cancelling nothing.
- **The concurrent packet-capture limit could be bypassed** by calling the
  blocking capture tool, which never registered a job.
- **`discover_network` with no arguments failed on a host whose interface
  carries a /8**, because the substituted default exceeded the /16 cap.
- **Workspace search jumped to the wrong row.** The search dialog listed
  rows in backend order and the table renders them sorted and filtered, so
  the position it handed over meant a different row — which is every scan,
  since each tool has a default sort.
- **A malformed result bundle blanked the window.** Import validated only
  that array-backed kinds got an array, so a bad entry threw during render
  with nothing to catch it, taking every other tab's state with it.
- **The desktop app stayed on "Detecting…" in silence** when interface
  polling kept failing, leaving the capture form with no interfaces and no
  explanation.
- **AUR packages are published against a re-hashed asset.** Both AUR jobs
  took the published `.sha256` sidecar on trust rather than downloading the
  asset and hashing it, which is the circular check the release scripts
  exist to prevent; the other registries already did this correctly.
- **The Windows installer verifies Npcap before running it.** `install.ps1`
  downloaded the Npcap installer from an overridable URL and launched it
  elevated with nothing checked; it now verifies the Authenticode signature
  and signer, and refuses to run an unsigned or unexpected binary.
- **`install.sh` no longer claims success before installing libpcap.** A
  user who asked for capture support could read "Installed successfully" and
  get a binary that cannot capture.

## [0.2.6] — 2026-05-06

### Fixed

- **GUI: in-app version display was stuck at `0.1.0`.** A stale
  `APP_VERSION` constant in `App.tsx` powered both the bottom-bar
  version readout and the About dialog, but it never got bumped
  alongside `package.json`, `tauri.conf.json`, or the workspace
  `Cargo.toml`s. Caught by a Winget moderator on
  [microsoft/winget-pkgs#368471](https://github.com/microsoft/winget-pkgs/pull/368471):
  the v0.2.4 build correctly reported `0.2.4` to the Windows registry
  (Tauri pulls `ProductVersion` from `tauri.conf.json`), but users
  saw `0.1.0` in the GUI itself. Wired `APP_VERSION` to read
  `package.json` at build time via Vite's `define` so the in-app
  display auto-syncs every release going forward.
- **GUI: title-bar buttons (close, minimize, maximize) didn't work
  on Windows.** Tauri 2's deny-by-default permission system requires
  explicit `core:window:allow-close/minimize/maximize/unmaximize/start-dragging`
  grants; the app was missing its capabilities config entirely.
  Added `src-tauri/capabilities/main.json`. (#62)

### Changed (internal)

- **Major refactor of TUI / CLI organization** ([#63](https://github.com/fstubner/netscli/pull/63)–[#67](https://github.com/fstubner/netscli/pull/67)):
  - `apps/netscli-cli/src/main.rs` shrank from 1870 → 527 lines (-72%).
  - `apps/netscli-cli/src/tui.rs` (2226 lines) decomposed into
    a `tui/` module with 8 focused files (state, events, widgets,
    palette, command_catalog, config, history, mod).
  - `apps/netscli-gui/src/App.tsx` shrank from 1480 → 931 lines (-37%)
    via per-tab views in `views/*View.tsx`.
  - `formatter.rs` renamed to `tui_formatter.rs` for naming
    consistency with `tui_export.rs`, `tui_settings.rs`.
  - All behavior-preserving; 25 tests pass on every PR's 3-OS matrix.
- **CI runner-minute spend cut by ~70% per PR** by collapsing the
  `release-build` matrix to ubuntu-only on PRs (full 3-OS only on
  push to main) and adding `paths-ignore` for docs/site/packaging
  changes. ([#61](https://github.com/fstubner/netscli/pull/61))

## [0.2.5] — 2026-05-05

### Security

- **hickory-resolver 0.24 → 0.26** closes
  [RUSTSEC-2026-0119](https://github.com/hickory-dns/hickory-dns/security/advisories/GHSA-q2qq-hmj6-3wpp):
  CPU exhaustion during message encoding due to O(n²) name compression
  in `hickory-proto`. The DNS lookup tab and any inspect/discover that
  resolves hostnames are no longer reachable through the vulnerable
  encoding path. The 0.26 builder pattern (`TokioResolver::builder_tokio()`)
  replaces the deprecated `TokioAsyncResolver::tokio` constructor; see
  PR #55 for the source migration. The `.cargo/audit.toml` ignore added
  in #52 was removed once the bump landed.

### Fixed

- **GUI: discover/sweep returned only a single host on Windows.**
  Root cause: `detect_default_ipv4_subnet` iterated
  `ipconfig::Adapter::prefixes()` and grabbed the first IPv4 entry, but
  that list contains the host's own /32, broadcast /32, multicast /4,
  link-local /16, and the network /24. Windows reports the host /32
  first, so the "subnet" was a single IP. New helper
  `pick_ipv4_subnet_from_prefixes` filters to network-shaped prefixes
  (length 1..=30, not multicast, not link-local) and truncates host
  bits, matching the Linux path. 5 unit tests added that run on every
  CI platform via `cfg(any(windows, test))`. (#59)
- **GUI: dashboard "Recent Scans" rendered with wrong colors / not as
  list rows.** `.history-item` is a `<button>` (for keyboard
  accessibility) but the CSS didn't reset user-agent button styles.
  WebView2 on Windows applied Win32 chrome (`color: ButtonText`,
  centered text, content-fit width, system button font), breaking the
  inherit chain for child labels. Explicit reset added. (#59)

### Changed

- **Dependencies (all transitive, no API surface impact):**
  - `crossterm 0.27 → 0.28` + `tui-textarea 0.4 → 0.7` had to land
    together — tui-textarea 0.7 hardcodes `crossterm = "0.28"`. (#58)
  - `mdns-sd 0.13 → 0.19` — adapt to the new `ScopedIp::to_ip_addr()`
    accessor in `netscli-core/src/mdns.rs`. (#58)
  - `clap 4.5.60 → 4.6.1` (#43), `pcap 1.3 → 2.4` (#45),
    `clap_mangen 0.2.33 → 0.3.0` (#46),
    `dialoguer 0.11.0 → 0.12.0` (#48), `dirs 5.0.1 → 6.0.0` (#51),
    `tokio 1.52.1 → 1.52.2` + `clap_complete 4.6.2 → 4.6.3` (#57).
- **`ratatui 0.29 → 0.30` deferred:** tui-textarea has no version yet
  that supports ratatui 0.30 (latest 0.7 still pins ratatui 0.29).
  Tracked via `@dependabot ignore` on the closed PR #49.

### Added

- **Release pipeline GUI automation.** `publish.yml` extended with 4
  parallel jobs that publish the GUI bundles to Homebrew Cask, Scoop
  extras (`netscli-gui.json`), Winget (`fstubner.netscli.gui`), and
  AUR (`netscli-gui-bin`) on every tagged release. (#54, #53, #56)

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

### Notes
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

### Notes
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

### Notes
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

[Unreleased]: https://github.com/fstubner/netscli/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/fstubner/netscli/releases/tag/v0.3.0
[0.2.6]: https://github.com/fstubner/netscli/releases/tag/v0.2.6
[0.2.5]: https://github.com/fstubner/netscli/releases/tag/v0.2.5
[0.2.4]: https://github.com/fstubner/netscli/releases/tag/v0.2.4
[0.2.3]: https://github.com/fstubner/netscli/releases/tag/v0.2.3
[0.2.2]: https://github.com/fstubner/netscli/releases/tag/v0.2.2
[0.2.1]: https://github.com/fstubner/netscli/releases/tag/v0.2.1
[0.2.0]: https://github.com/fstubner/netscli/releases/tag/v0.2.0
[0.1.1]: https://github.com/fstubner/netscli/releases/tag/v0.1.1
[0.1.0]: https://github.com/fstubner/netscli/releases/tag/v0.1.0
