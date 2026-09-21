# Changelog

All notable changes to netscli are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Workspace crates (`netscli`, `netscli-core`, `netscli-mcp`) and the
desktop app are released together under one version number. Note that
they do not *inherit* it — each crate sets its own, and the GUI carries
further copies in `package.json` and `tauri.conf.json`. See
`docs/PUBLISHING.md` for the full list of files a bump has to touch.

A version heading carries a date, and a link, only once its release is
published. Both are claims about the outside world, and the website reads
them: it printed "24 Aug 2026" for 0.3.1 for four days on the strength of a
date written here when the notes were drafted. An in-flight version keeps
its heading and collects entries; the date and the link go on with the tag.

## [0.3.2] — 2026-09-21

### Added

- **Discover names hosts from mDNS when reverse DNS cannot.** Consumer routers
  do not serve PTR records for their own DHCP clients, and appliances ignore
  LLMNR and NetBIOS, so reverse lookup returned nothing for exactly the devices
  someone opened the app to identify. Those devices announce their names over
  mDNS constantly, and netscli has shipped an mDNS browser all along as a
  separate operation that discover never consulted. It does now, filling only
  the blanks, so nothing that resolves today changes. On one ordinary /24 that
  named 3 more of 26 hosts, taking 21 named to 24. Results carry a
  `hostname_source` of `reverse` or `mdns`, since a name from a device's own
  announcement is a different kind of claim from one in DNS.
- **The desktop app says the MCP server exists.** Someone who only ever opens
  the app had no way to learn that netscli ships an MCP server, let alone
  connect an agent to one. There is now a panel that looks for a netscli binary
  and gives you the client configuration to paste, including what to do when it
  cannot find one — the desktop installers do not carry the CLI.

### Fixed

- **`netscli` with no arguments no longer hangs when there is no terminal.**
  With no subcommand it opens the TUI, which needs a terminal to draw on and
  read from. Without one it did not fail, it blocked forever: raw mode was
  entered and the runtime then waited on input that could never arrive. So
  `netscli | head`, or `netscli` from a script or a CI job, ran until
  something killed it. It now prints what `--help` prints and exits 0. The TUI
  is unchanged wherever there is a terminal.

  This has been the behaviour since 0.1.0, and it is what has kept the CLI's
  winget package on 0.2.6. Winget's validation runs the executable and waits
  for it, so the 0.3.1 submission has sat since 12 September carrying
  `Validation-Executable-Error` while the desktop app's went through the same
  day.
- **The docs site lost its navigation and its theme switch between 800px and
  1152px wide, and the search button sat stranded beside the wordmark.** The
  header links — Features, Install, FAQ, Docs, Changelog, GitHub — and the
  light/dark control were both hidden across that range, on the understanding
  that the mobile menu carried them from there down. The button that opens
  that menu only appears below 800px, so for 352px of width there was nothing
  to press and no way to reach any of it. The docs sidebar is not a
  substitute: it lists the pages of the docs and carries five of those six
  links nowhere.

  The search button had a second fault behind it. The width at which the links
  hide moved from 900px to 1152px and two rules that depended on that number
  stayed put, so the layout seam ended up on a hidden element, which takes no
  part in the layout. Search fell back to the left with up to 861px of empty
  bar beside it.

  A new check measures where the header's controls sit at seventeen widths.
  Neither fault was visible to the existing accessibility, contrast or
  performance gates, because both are about position rather than markup,
  colour or speed.

- **`netscli-gui-bin` on the AUR installed a desktop app that could not
  start.** The PKGBUILD did not set `options=('!strip')`, and `strip` is in
  makepkg's default options. An AppImage is the AppImage runtime — an
  ordinary static ELF — with a squashfs image appended after everything the
  ELF headers describe, so stripping it rewrote the file from its section
  table and threw the appended image away. What reached `/usr/bin` was the
  944,632-byte runtime out of a 79 MB download, and running it said only
  "This doesn't look like a squashfs image". The package built, installed and
  verified its checksum at every step, because the truncation happened after
  the checksum was checked. Reported in #377.
- **The Linux desktop AppImage no longer aborts on hosts with a newer Mesa.**
  It failed with `Could not create default EGL display: EGL_BAD_PARAMETER`
  before any window appeared. The AppImage carried its own copies of nine
  display-stack libraries — the wayland client stack, `libxkbcommon`, and
  part of the xcb/X11 stack — and put them ahead of the host's, so the host's
  Mesa was made to talk to the wayland client library from the machine the
  release was built on. Those libraries are now removed from the image after
  it is built. Reported in #378 against v0.2.6 on Mesa 26.2.2; v0.3.1 bundled
  the same nine.
- **A desktop window that opens black or blank now recovers on the next
  launch.** WebKitGTK's hardware compositing can fail against a driver that
  only partly supports it, and it fails silently: the window opens, nothing
  paints, and there is nothing on stderr to go on. Seen on virtual machines
  using `vmwgfx`. The app now marks each launch and clears the mark once the
  UI has actually drawn a frame, so a launch that never drew one is noticed by
  the next, which turns hardware compositing off and says why.

  This could not be a setting in the app. Every GUI preference lives in the
  webview's `localStorage`, and the webview is the part that is not rendering,
  so someone looking at a blank window cannot reach any of it. Alongside the
  automatic recovery there are now `--disable-gpu-compositing` and
  `--gpu-compositing` flags, which are remembered across launches. Linux only:
  the other two platforms use a web engine with neither the fault nor the
  setting. Also reported in #378.
- **Text in the desktop app's result tables can be selected again.** Both the
  table and its wrapper set `user-select: none`, so a port, MAC address,
  vendor string or banner could not be dragged over with the mouse — and those
  values are on screen precisely so they can go somewhere else. The only route
  out was the detail pane. Selecting rows is a click, not a drag, so nothing
  was gained by it. Reported in #417.
- **The website's release notes lost their paragraph breaks, and the fade over
  a long entry read navy rather than matching the page.** Both on the changelog
  page.

### Changed

- **The website and docs got another pass.** The install section's two
  controls line up and its alternatives stopped shouting; the hero badge shows
  the released version; the interfaces are shown rather than described; the
  README says only what a README can and its TUI screenshots work again; the
  comparison with nmap and the other scanners is fairer in both directions.
  Docs pages carry structured data, and the docs shell picked up a Lighthouse
  gate and two fixes it found.

### Security

- **Three open advisories cleared.** `rustls` 0.23.40 → 0.23.45
  (RUSTSEC-2026-0285, medium), which was in 0.3.1's lockfile and so is in the
  binaries that release produced. The other two are the website's build
  dependencies rather than anything in a release artifact: `adm-zip` ≤0.6.0
  (GHSA-vwc7-r8mq-g2x9 and GHSA-7q85-xj36-vmfc, high) and `devalue` <5.9.1
  (GHSA-9rgm-9g3h-6x36, moderate).

## [0.3.1] — 2026-09-11

The first release since 0.2.6 in May, and a large one: four months of work on
the desktop app, the shared core and the website.

The headline is the desktop app. Everything listed under it is new to anyone
upgrading from 0.2.6 — the old dashboard-style GUI is gone, and what replaces
it is a different application rather than a revision of that one. The rest is
additive work in the core, CLI and MCP server, and a long tail of fixes. The
recurring theme in that tail is code that reported success while doing nothing.

### Added

- **The desktop app is a diagnostic workspace.** NetsCLI Desktop replaces the
  earlier dashboard with a native-like shell built around operation tabs. It
  runs the same `netscli-core` operations as the CLI, TUI and MCP server, so
  its results match the rest of the tool. What it does:
  - Operation tabs you can reorder by drag or keyboard, and close individually,
    to either side, or all at once from a right-click menu.
  - Sortable and filterable result tables, row detail panes, and a preview of
    the CLI command each run is equivalent to.
  - Save a whole workspace of results to a file and reopen it later; export CSV
    or JSON, whole or selection-only. Exported cells are escaped against
    spreadsheet formula injection, since banners and hostnames are chosen by
    the scanned host.
  - Light and dark themes, and a settings dialog covering probe concurrency,
    default and traffic interfaces, IPv4/IPv6 display preference, history and
    save behaviour, and notification preferences.
  - Full keyboard operation, and a refreshed icon matching the site's brand.
- **Clear the ARP table, then discover.** A chevron beside Run offers a
  cache-flushing variant on discover, sweep and the ARP tab — the tools where a
  stale neighbour entry changes the answer. Clearing needs administrator
  rights; when it fails the run is suppressed rather than quietly returning the
  stale entries it was meant to drop.
- **Richer port scan results across every interface.** Port scans now report
  additive status and detail fields (`open`, `closed`, `filtered`, `error`,
  latency, banners, HTTP metadata, TLS metadata, and raw previews where
  available) while keeping the older `open`, `port`, `service`, and `error`
  fields intact for compatibility.
- **User-configurable probe concurrency.** The CLI and MCP server already
  accepted concurrency limits; the desktop app and TUI settings now expose the
  same control, so probes can be reduced on fragile networks or raised within
  the core safety cap.

### Changed

- **`netscli scan --json` now reports every port, not just the open ones.**
  Filtering to open ports made "all closed", "all filtered" and "every probe
  errored" the same empty array, so a script could not tell a clean scan from a
  host that refused every probe. Each entry carries `open` and `status`, so
  callers that want only open ports can filter for them.
- **The MCP server now scans only local networks by default.** This is the one
  surface driven by a model rather than by the person at the keyboard, so the
  instruction to scan a third party can arrive from a web page or a file
  someone else wrote — and the packets leave from your machine and your IP.
  RFC1918, loopback, link-local and the carrier-grade NAT range overlay
  networks use are allowed; set `NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1` to reach
  past them.
- **Scan results returned to a model are capped.** The full probe response
  (`raw`) is no longer included and banners are truncated, both being bytes
  chosen by the scanned host.
- **Tool failures are returned as MCP `isError` results** rather than JSON-RPC
  errors, so a failed scan no longer reads to a client as a broken server.
- **CLI and TUI scan output reflects the richer status data.** Human output
  stays concise, but scanned ports can show closed, filtered and error states
  with latency where available, instead of only emphasising open ports.
- **Windows install guidance prefers Winget for the desktop app.** Winget's
  manifest review and installer hash verification make it the recommended
  Windows path; direct GitHub Windows installers remain unsigned and may show
  warnings until code signing is added.
- **Linux/macOS install docs clarified.** mDNS is the default pure-Rust
  capability in published builds; packet capture remains the optional workflow
  depending on libpcap/Npcap.
- **The website and docs were rebuilt.** A consistent shell, unified code and
  table styling, clearer search, and a layout swept across six widths and both
  themes. The brand accent moved from a teal-green that read blue in small text
  to one that reads green at any size.

### Fixed

- **Pinging your own machine no longer reports 100% loss.** On Windows,
  `ping 127.0.0.1` — and the machine's own LAN address — timed out while the
  system `ping` answered immediately. Raw ICMP sockets need administrator
  rights, so an ordinary run fell back to TCP probes on ports 80/443/22 and
  concluded a host was down when nothing answered; and a Windows raw socket
  does not observe traffic to an address the host owns. Windows now sends
  echoes through the IP Helper API, which needs no privileges and reaches local
  addresses. Discover and sweep both start from a ping sweep, so both returned
  nothing for any range covering this host.
- **IPv6 hosts can be pinged.** `ping ::1` reported total loss because IPv6 had
  no ICMP path at all and fell through to the same TCP probe. Windows now uses
  `Icmp6SendEcho2`.
- **`netscli arp --clear`, `--add` and `--delete` no longer claim to have
  changed the table when they have not.** On Windows these print "The requested
  operation requires elevation" and then exit 0, so checking the exit status
  alone reported success while nothing was touched — an ordinary run printed
  "ARP entry added for 192.0.2.77", and `"ok": true` in JSON, having done
  nothing. All three now share one check and exit non-zero with the reason.
  `--clear` also errors on platforms where it was never implemented, instead of
  reporting a cleared table.
- **Discover reports devices the OS already knows about.** Results merge probe
  replies with the neighbour table, so a device that answers ARP but not ICMP
  is no longer missing. Each host records whether it was found by probe or by
  neighbour, since a stale neighbour entry can outlive the device.
- **Safety limits were enforced in `Ops` but not in the engines.** The scan,
  sweep, discover and inspect engines are public API re-exported at the crate
  root, and called directly they applied no subnet, port or concurrency cap —
  `0.0.0.0/0` collected 4,294,967,294 addresses into a `Vec` before sending a
  packet. Every engine now enforces its own limits.
  ([#198](https://github.com/fstubner/netscli/pull/198))
- **Safety limits that only one caller was applying.** `SweepEngine::sweep`
  validates its port list instead of trusting the caller and silently returning
  "no open ports"; mDNS browse duration, `ping -c` and packet captures given a
  packet count but no duration all gained the core-side ceiling they were
  documented to have.
- **Port 0 was rejected only by the MCP surface.** Now rejected everywhere.
  ([#164](https://github.com/fstubner/netscli/pull/164))
- **MCP server handled one request at a time.** The read loop awaited each
  handler before parsing the next line, so a slow scan blocked every other
  request on the connection, including cancellation. Handlers now run
  concurrently under a semaphore.
  ([#169](https://github.com/fstubner/netscli/pull/169))
- **Reading the ARP table blocked a runtime worker.** On Windows and macOS it
  shells out to `arp` and waits on the child process; three callers invoked it
  straight from async code. With MCP handlers capped at 16 concurrent, sixteen
  of these could stall every worker — including the one reading stdin, so no
  further request could even be parsed. Moved to a blocking thread.
  ([#196](https://github.com/fstubner/netscli/pull/196))
- **Four ways an MCP client could wedge or kill the server**: no overall
  request deadline, permits acquired after spawning rather than before, a
  single invalid UTF-8 byte on stdin terminating the process, and client
  disconnect cancelling nothing.
- **The MCP server no longer says it returned everything while truncating.** A
  capped result reported the byte count as its item count, so a 40,000-row scan
  that returned 11,518 rows said `returned: 40000, total: 40000` beside
  `truncated: true`.
- **Packet captures fetched as a background MCP job are bounded like every
  other result.** `get_pcap_capture_result` was routed before the limits that
  strip and truncate remote text, so the one result made entirely of bytes off
  the wire was the one that skipped them.
- **The concurrent packet-capture limit could be bypassed** by calling the
  blocking capture tool, which never registered a job.
- **`discover_network` with no arguments failed on a host whose interface
  carries a /8**, because the substituted default exceeded the /16 cap.
- **A database written by a newer netscli is refused rather than read.** The
  version check treated a future schema as "already migrated", so an older
  build queried tables it had never seen.
- **`netscli trace` no longer prints router-supplied hostnames unsanitised.**
  Hop names come from PTR records controlled by whoever runs those routers, and
  this was the last plain-text output path without the terminal-safety pass
  every other one had.
- **TUI mis-measured wide characters**, so CJK and emoji in a remote-supplied
  hostname or banner pushed box borders out of alignment.
  ([#173](https://github.com/fstubner/netscli/pull/173))
- **Panic paths in the core, and silent corruption in the OUI generator.**
  ([#172](https://github.com/fstubner/netscli/pull/172))
- **winget publishes the version number, not the tag.** Both package manifests
  were passed the tag including its `v`, which the action only strips when the
  input is left empty. `v0.2.2` through `v0.2.6` are already in the public
  catalog that way, so `winget show netscli` reports a version this project
  never issued. Upgrades still work — winget normalises a leading `v` when
  comparing — and this release fixes what is displayed. The publish job now
  asserts `MAJOR.MINOR.PATCH` rather than trusting the strip, because
  winget-pkgs accepted all five without complaint and a merged manifest is
  permanent.
- **AUR packages are published against a re-hashed asset.** Both AUR jobs took
  the published `.sha256` sidecar on trust rather than downloading the asset and
  hashing it, which is the circular check the release scripts exist to prevent;
  the other registries already did this correctly.
- **The Windows installer verifies Npcap before running it.** `install.ps1`
  downloaded the Npcap installer from an overridable URL and launched it
  elevated with nothing checked; it now verifies the Authenticode signature and
  signer, and refuses to run an unsigned or unexpected binary.
- **`install.sh` no longer claims success before installing libpcap.** A user
  who asked for capture support could read "Installed successfully" and get a
  binary that cannot capture.

### Website

- **Small grey text was unreadable on card surfaces.** The docs footer,
  built-with row and mobile section labels use `--sl-color-gray-3`, much of it
  at 12px. It had been raised once to clear 4.5:1 against the page background,
  but nothing checked it against the slightly darker card surface, where it sat
  at 4.44:1.
- **Muted text, and several status colours, were below the readability bar.**
  Eight colour tokens failed WCAG AA (4.5:1) against surfaces they are actually
  painted on — the mint accent failed as text on every light surface, down to
  3.85:1. All 84 foreground/surface combinations now clear 4.5:1, and a check
  keeps them there.
- **The install guide has the verification steps the landing page promises.**
  It advertised checksums and Sigstore signatures and linked to a page with
  none of them on it.
- **The site claimed packet capture in builds that do not ship it**, and
  advertised a version that was never released.
  ([#194](https://github.com/fstubner/netscli/pull/194),
  [#208](https://github.com/fstubner/netscli/pull/208))
- **The interface coverage table no longer conflates separate things.** Rows
  that merged setup with doctor, or reading the ARP table with changing it, are
  split, and dashes that meant "not applicable" say which.
- **The FAQ answers two questions people actually search for**, from Search
  Console data rather than guesswork: whether there is a `netscan` command, and
  whether this replaces nmap and has a terminal UI.

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

[Unreleased]: https://github.com/fstubner/netscli/compare/v0.3.1...HEAD
[0.3.2]: https://github.com/fstubner/netscli/releases/tag/v0.3.2
[0.3.1]: https://github.com/fstubner/netscli/releases/tag/v0.3.1
[0.2.6]: https://github.com/fstubner/netscli/releases/tag/v0.2.6
[0.2.5]: https://github.com/fstubner/netscli/releases/tag/v0.2.5
[0.2.4]: https://github.com/fstubner/netscli/releases/tag/v0.2.4
[0.2.3]: https://github.com/fstubner/netscli/releases/tag/v0.2.3
[0.2.2]: https://github.com/fstubner/netscli/releases/tag/v0.2.2
[0.2.1]: https://github.com/fstubner/netscli/releases/tag/v0.2.1
[0.2.0]: https://github.com/fstubner/netscli/releases/tag/v0.2.0
[0.1.1]: https://github.com/fstubner/netscli/releases/tag/v0.1.1
[0.1.0]: https://github.com/fstubner/netscli/releases/tag/v0.1.0
