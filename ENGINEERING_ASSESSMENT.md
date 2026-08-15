# NetsCLI — Independent Engineering Assessment

**Date:** 2026-08-12
**Commit:** `bf5deda` on `site/recover-redesign` (1 ahead of `origin/main` `3a008b9`)
**Assessor:** Independent audit, no reliance on prior review documents except to verify their claims.

---

## 1. Scope

**In scope — read in full or analysed programmatically:**

| Area | Coverage |
| --- | --- |
| `crates/netscli-core/` | All 60 source files, `tests/config_safety.rs` |
| `crates/netscli-mcp/` | All 10 source files, `tests/tools_list.rs` |
| `apps/netscli-cli/` | ~55 of 62 source files, `tests/mcp_stdio.rs` |
| `apps/netscli-gui/src-tauri/` | All Rust, `tauri.conf.json`, `capabilities/`, `nsis/`, `wix/` |
| `apps/netscli-gui/src/` | ~45 of 87 modules in full; remainder grepped for injection/ARIA/type-safety |
| `apps/netscli-gui/e2e/` | 4 of 12 files in full, rest by assertion grep |
| `site/` | Config, scripts, pages, layouts, 7 of 11 docs pages; all 48 CSS files parsed programmatically |
| `.github/` | All 7 workflows, `dependabot.yml`, `release-drafter.yml` |
| `scripts/`, `packaging/`, `docs/` | All files |

**Depth:** `deep` for `netscli-core`, `netscli-mcp`, CI/release/packaging, and the Tauri backend. `targeted` for the GUI frontend and site. Every check in the methodology was attempted and its result recorded, including those that could not run.

**Explicitly out of scope:** binary assets (icons, screenshots, `oui.min.json.gz`), lockfiles (`Cargo.lock`, `package-lock.json` — skimmed for unexpected registries only, none found), `LICENSE`, and the untracked `HANDOVER.md` (read for context, not audited).

**Not performed:** load testing, fuzzing, penetration testing, runtime testing on macOS or Linux (Windows-only host), PCAP-feature builds (no Npcap SDK present), and the Tauri render e2e suite (requires a full GUI build).

---

## 2. Environment

- **Languages/runtimes:** Rust 1.96.0 (pinned via `rust-toolchain.toml`), Node 24.14.1 / npm 11.11.0, TypeScript 5.5.
- **Workspace:** 4 Cargo members (`netscli-core`, `netscli-mcp`, `netscli` CLI, `netscli-gui` Tauri backend), resolver v2, `scripts/` excluded.
- **Frameworks:** tokio, sqlx (sqlite), hickory-resolver, pnet, ratatui 0.30 + crossterm, clap 4, Tauri 2.11, React 19 + Vite 8, Astro 7 + Starlight 0.41.
- **Domain:** cross-platform network scanner with four interfaces (CLI, TUI, desktop GUI, MCP server) over one core library.
- **Distribution:** GitHub Releases (cosign-signed), crates.io, Homebrew, Scoop, winget, AUR, and `curl | bash` / `iwr | iex` installers.

This suite's own checkers (`check-smells`, `check-frontend`, etc.) do not apply to a Rust/Astro codebase and were not run; the repo's equivalent is `scripts/check-file-size.mjs`, which was run.

---

## 3. Tooling Results

### Ran successfully

| Check | Result |
| --- | --- |
| `cargo fmt --check` | **Pass**, no diff |
| `cargo clippy --workspace --all-targets -- -D warnings` | **Pass**, zero warnings |
| `cargo test --workspace` | **Pass** — 99 tests (core 57, CLI 23, MCP 8, `config_safety` 5, `mcp_stdio` 5, `tools_list` 1); GUI backend 0 |
| `node scripts/check-file-size.mjs` | **Pass**, no output |
| `npm run test:unit` (GUI) | **Pass** — 57 tests, 10 files |
| `npm run build` (GUI) | **Pass** — tsc + Vite, 358.90 kB main bundle |
| `npm run check` (site) | **Pass** — 42 files, 0 errors/warnings/hints |
| `npm run build` (site) | **Pass** — 14 pages, Pagefind index, sitemap |
| `cargo audit` | **FAIL — 3 vulnerabilities, 4 allowed warnings** (see A-12) |
| `npm audit` (GUI) | **FAIL — 2 high** (dev-only; `--omit=dev` is clean) |
| `npm audit` (site) | **Pass** — 0 vulnerabilities |
| Live MCP concurrency probe (custom) | **Confirmed head-of-line blocking** (see A-01) |
| Live release-asset HTTP probe (custom) | **v0.3.0 assets 404** (see A-04) |
| crates.io API version query | **All three crates at 0.2.6** (see A-04) |

### Could not run

| Check | Reason | What it would have revealed |
| --- | --- | --- |
| `cargo clippy/test --features pcap` | Npcap SDK not installed; `scripts/test-pcap.ps1` requires `wpcap.lib` | Lint/test status of ~800 lines of pcap code, incl. `pcap/protocols.rs` |
| `npm run test:tauri-render` | Requires a full Tauri build + WebDriver | Whether the 12-file e2e suite currently passes |
| `npm run test:a11y` (site) | Requires headless Chrome for `@axe-core/cli` | Whether the 7 gated routes are still violation-free |
| macOS/Linux platform paths | Windows-only host | `arp`/`ping`/`trace` Unix branches, `.deb`/`.dmg` bundling |

---

## 4. Findings

**No Critical findings.** Nothing observed causes unavoidable data loss or constitutes an active security breach. The most serious issues are supply-chain hardening gaps and a release-state inconsistency, rated High.

### High

| # | Area | Finding | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| A-01 | Reliability | **MCP server processes requests strictly sequentially.** One slow tool call blocks every other request, including cancellation. The pcap job system exists to work around this, but only for captures — a `sweep_network` over a /16 freezes the whole server. | `crates/netscli-mcp/src/server.rs:55-88` — the read loop `await`s `handle_request` inline before reading the next line. **Empirically confirmed:** a `tools/list` written in the same tick as a slow `ping_host` returned at `t=+9339ms`, 1 ms after the ping's `t=+9338ms`. | Spawn each request onto a task and write responses through an `mpsc` channel. JSON-RPC ids already allow out-of-order replies. |
| A-02 | Security | **DNS TXT record contents reach the terminal unescaped.** A hostile authoritative server for any looked-up domain can emit raw ANSI/OSC sequences — screen forgery, title-bar set-and-report, OSC 52 clipboard writes. No LAN access needed. | `crates/netscli-core/src/dns/records.rs:38-52` (`normalize_value` strips quotes/dots only) → `apps/netscli-cli/src/commands.rs:189` `println!("  {value}")`. Verified in `hickory-proto-0.26.1/src/rr/rdata/txt.rs:169-171`: `impl Display for TXT` is `from_utf8_lossy` with **no escaping**, unlike `Name`/`Label`. | Apply a shared `sanitize_for_terminal` at every `cli_formatter`/`commands.rs` print site. The right primitive already exists at `scan/probes/mod.rs:62`. |
| A-03 | Security | **mDNS hostnames and service names reach the terminal unescaped.** Any device on the local link can advertise a service name containing `0x1b`. | `crates/netscli-core/src/mdns.rs:116` `get_hostname().to_string()` → `apps/netscli-cli/src/cli_dispatch/mdns.rs:46` `println!("{host}  [{addr_list}]")`. `mdns-sd-0.19.2` `escape_instance_name` escapes only `.` and `\`. | Same fix as A-02. |
| A-04 | Data integrity | **v0.3.0 is stamped across the entire repo but was never released.** All 4 crate manifests, `package.json`, `tauri.conf.json` say `0.3.0`; `CHANGELOG.md:12` dates it `2026-06-26`; `SECURITY.md` declares `0.3.x` supported and `<0.3` unsupported — telling every actual user their version is EOL. | Live probes: `releases/tag/v0.3.0` → **HTTP 404**; `releases/download/v0.3.0/netscli-windows-x86_64.exe` → **404** (v0.2.6 equivalent → 200). `git ls-remote --tags` ends at `v0.2.6`. crates.io API: `netscli`, `netscli-core`, `netscli-mcp` all `max_version: 0.2.6`. `CHANGELOG.md:430` links a 404. | Either cut v0.3.0 or revert the version stamps and move the changelog entry back under `[Unreleased]`. Fix `SECURITY.md` to cover 0.2.x until 0.3.0 actually ships. |
| A-05 | Security | **Release workflow downloads the Npcap SDK with no integrity check**, then links it into cosign-signed Windows pcap binaries. The signature attests to a build that trusted an unverified third-party artifact. | `.github/workflows/release.yml:122-126` — `Invoke-WebRequest -Uri "https://npcap.com/dist/npcap-sdk-1.13.zip"` → `Expand-Archive`. No hash, no signature check. | Pin the SDK's SHA256 and verify before extraction. |
| A-06 | Security | **Installers silently proceed when the checksum sidecar is unavailable.** An on-path attacker need only fail the `.sha256` request to downgrade to no verification — the script prints a warning and installs anyway. The checksum also comes from the same origin as the binary, so it only ever detects corruption, never compromise. cosign signatures — the actual integrity story, advertised in `README.md:171-182` — are never checked by any install path. | `scripts/install.sh:250-255` (`download_optional` → on failure `NETSCLI_SHA256` stays empty), `:267-269` (warn and continue). Same shape at `scripts/install.ps1:130-137, 149`. | Fail closed when the sidecar 404s for a release that should have one. Better: verify the cosign signature, which is origin-independent. |
| A-07 | Security | **Every third-party action is tag-pinned, not SHA-pinned**, in workflows holding `contents: write` and `id-token: write`. A retagged or compromised action could exfiltrate the OIDC token and mint Fulcio certs as this repo. | `.github/workflows/release.yml:169` `sigstore/cosign-installer@v3`, `:182` `softprops/action-gh-release@v3`, `:105` `dtolnay/rust-toolchain@stable`; `publish.yml:134` `vedantmgoyal2009/winget-releaser@v2`, `:204` `KSXGitHub/github-actions-deploy-aur@v4.1.3`. `docs/RELEASE.md:213-222` acknowledges this tradeoff. | SHA-pin at minimum the actions in `release.yml` and `publish.yml`. |
| A-08 | Security | **Unvalidated `TAG` reaches an unquoted heredoc.** `publish-homebrew-cask.sh:60` uses `<<EOF` (undelimited), so `${VERSION}` and remotely-fetched `${SHA[...]}` values at `:71,76` undergo command substitution in a runner holding `GH_TOKEN`. No script validates `TAG` against `^v[0-9]+\.[0-9]+\.[0-9]+$`. | `scripts/release/publish-homebrew-cask.sh:16-17, 47, 60, 71, 76`. Related: `publish-homebrew.sh:62` interpolates `${VERSION}` into a `sed -E` replacement where `\|` and `&` are metacharacters. | Quote the heredoc (`<<'EOF'`) and validate `TAG` on entry to all four publish scripts. Requires repo write to exploit, so this is privilege escalation toward secrets, not anonymous RCE. |
| A-09 | Data integrity | **`generate-oui.rs` can silently ship a gutted vendor database.** Three compounding defects: no `error_for_status()` (a 403 body is parsed as CSV); a missing header row returns an empty map with no error; and the output is overwritten unconditionally with no minimum-entry floor or diff gate. IEEE rate-limits unknown user agents, and `Client::builder()` sets none. | `scripts/generate-oui.rs:37-38`, `:66-68`, `:146`, `:170-192`. `scripts/generate-oui.md:26-33` documents no verification step. | Add `error_for_status()`, error on a missing header, and refuse to write if the new dataset is <90% of the existing entry count. |
| A-10 | Correctness | **`packaging/winget/{cli,gui}/0.2.6/` were overwritten with 0.3.0 manifests.** `diff` against the `0.3.0/` directories produces zero output for all six files. winget-pkgs uses one directory per version, so submitting from `0.2.6/` files a conflicting duplicate; the historical 0.2.6 record is destroyed. | `packaging/winget/cli/0.2.6/fstubner.netscli.installer.yaml:9` `PackageVersion: 0.3.0`, `:13` points at `v0.3.0`. Introduced in commit `e20b0ec`. | Restore the 0.2.6 manifests from git history (or delete the directories, since they are no longer a valid record). |
| A-11 | Correctness | **`netscli setup --execute` cannot work on Linux or Windows.** `run_command_line` does `shell_words::split` then spawns argv directly with no shell, but the Linux recommendation contains `&&` (passed as a literal argument to `sudo`) and the Windows one is prose beginning with the word `Install`. Only the macOS `brew` string is valid argv. | `apps/netscli-cli/src/setup.rs:119-126` → `setup/commands.rs:20-31`; strings at `setup/commands.rs:8-18`. | Mark non-brew entries advisory-only (print, never execute), or route them through an explicit shell. |
| A-12 | Dependencies | **`cargo audit` fails with 3 vulnerabilities.** Two are High (CVSS 7.5) in `quick-xml` 0.39.4 — quadratic parse time and unbounded namespace allocation, both DoS. Reached via `plist` → `tauri-utils` → Tauri 2, i.e. build-time and app-config parsing. Plus `crossbeam-epoch` 0.9.18 invalid-pointer-deref. | `cargo audit` output; `cargo tree -i quick-xml` confirms the Tauri path. `docs/SECURITY_REVIEW.md:151` claims "clean" — accurate on 2026-05-29, stale now. | Bump `quick-xml >=0.41.0` and `crossbeam-epoch >=0.9.20`, or add justified `audit.toml` ignores. Not currently gating CI merges because `audit.yml` only triggers on manifest changes. |
| A-13 | Correctness | **Stale closure sends "jump to row" to the wrong tab.** `setTimeout(…, 0)` fires after commit but retains the pre-`setActiveTabId` closure, so Ctrl+K → select a row in another tab mutates the *previous* tab's selection and clamps against its row count. | `apps/netscli-gui/src/components/shell/AppDialogs.tsx:188-191`; `workspace/useWorkspace.ts:161-208` closes over `activeTab`/`rows`. Reachable via `WorkspaceSearchDialog.tsx:69-79`. | Pass `tabId` through to `selectRow` instead of relying on the effect ordering, or drive it from a `useEffect` keyed on `activeTabId`. |

### Medium

| # | Area | Finding | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| B-01 | Security | The 4096-port cap lives in the *string parser*, not in `Ops`. `netscli-core` is published on crates.io, so a downstream consumer calling `Ops::scan_ports(host, Some(big_vec))` bypasses it. Cap logic is also duplicated in MCP — the drift risk `SECURITY_REVIEW.md` F-01 aimed to remove. | Cap at `crates/netscli-core/src/common/ports.rs:75` only; `ops/scan.rs:41-62, 64-77, 79-109` take `Option<Vec<u16>>` and pass it straight through. Second copy at `crates/netscli-mcp/src/server/schemas.rs:48`. | Enforce in `Ops::scan_ports`/`inspect_host`/`sweep_ipv4`; delete the MCP copy. |
| B-02 | Security | Unbounded subnet expansion in the public discover API — a `/8` materialises ~16.7M `IpAddr` (~270 MB) before any work starts. MCP and CLI guard it; the library entry point does not. | `crates/netscli-core/src/discover.rs:78` `subnet.hosts().map(IpAddr::V4).collect()`. `DiscoverEngine::scan_subnet`/`SweepEngine::sweep` are public and unguarded. | Move `parse_limited_ipv4_subnet` enforcement into the engines. |
| B-03 | Security | Nothing in the publish chain verifies a hash against actual bytes — all four scripts read the release's own `.sha256` sidecar and never re-hash the asset, so verification is circular. Worse, the sanity checks are hash-blind: `grep -c '^      sha256 "'` matches `sha256 ""`, so a malformed sidecar yields a formula with blank hashes that passes and gets pushed. | `publish-homebrew.sh:47,81`, `publish-homebrew-cask.sh:47,96`, `publish-scoop.sh:30`, `publish-scoop-gui.sh:30`. `docs/RELEASE.md:136-140` admits cosign is never checked. `packaging/README.md:46-49` asserts a rule the automation does not implement. | Download the asset, re-hash it, and validate the value is 64 hex chars. |
| B-04 | Security | Two different cosign verify commands are documented, and the widely-read one is weaker: `docs/RELEASE.md:145` uses `--certificate-identity-regexp 'https://github.com/fstubner/netscli/.*'`, accepting a signature from *any* workflow in the repo. | `packaging/README.md:31` has the correct workflow-scoped regex; `docs/RELEASE.md:145` and `README.md:177` have the broad one. | Use the workflow-scoped regex everywhere. |
| B-05 | Security | The MSI downloads and executes an installer from the network at install time, elevated. Tauri's default `downloadBootstrapper` applies (no `webviewInstallMode` set), activating a deferred custom action running `powershell.exe … Invoke-WebRequest … Start-Process`. No hash pinning; offline installs fail. | `apps/netscli-gui/src-tauri/wix/main.wxs:290-298`, `:28` `InstallScope="perMachine"`, `:332` runs as SYSTEM. `docs/RELEASE.md:184-186` flags this as disqualifying for a future Store submission. | Set `webviewInstallMode` to `embedBootstrapper` or `offlineInstaller`. |
| B-06 | Reliability | Byte-slice panic in `oui.rs` on non-ASCII input: `&key[..6]` where `key.len()` is bytes. `lookup_vendor` is public API. Internal callers are safe only incidentally. | `crates/netscli-core/src/oui.rs:16-25`, same bug at `:85-88`. No tests exist for this module. | Use `.chars().take(6)` or guard `is_char_boundary`. |
| B-07 | Correctness | `truncate_line_to_width` mixes display width with char count — `max_width` comes from `unicode_width` but the loop accumulates `take.chars().count()`. CJK/emoji in a remote-supplied hostname or banner push the box border off. | `apps/netscli-cli/src/tui/widgets/lines.rs:71-93`. | Accumulate `UnicodeWidthStr::width`. The correct primitive exists at `tui_formatter/common.rs:57-94`. |
| B-08 | Correctness | TUI input widget is char-indexed, not width-indexed — pads to `width` with `chars.len()` and slices `avail` chars. Wide characters misplace the cursor and overflow the input box. | `apps/netscli-cli/src/tui/widgets/input.rs:35-72, 104-109`; `widgets/scroll.rs:22-33` inherits it. | Reuse `fit_cell`'s width accounting. |
| B-09 | Reliability | Banner `\r` survives sanitization and reaches the CLI table. `sanitize` deliberately preserves `\r`; `first_banner_line` strips only *trailing* `\r`. A scanned host can carriage-return over its own row and forge preceding output. | `crates/netscli-core/src/scan/probes/mod.rs:62-74`; `probes/http.rs:90-98`; sink `cli_formatter/scan.rs:86`. | Drop `\r` from the carve-out, or strip it in the formatter. |
| B-10 | Reliability | Five sync-in-async call sites block tokio workers: `event::poll(tick_rate)` (100 ms/iteration), `NetworkManager::find_mac` (spawns `arp` on Win/macOS), `pcap_check_support()` called twice per `/pcap`, `monitor.get_stats()` holding a mutex across a syscall in the draw path, and `detect_default_ipv4_addr()` at startup. | `tui/runtime.rs:31,40`; `tui/events/scan.rs:100`; `tui/events/pcap.rs:125,155`; `tui/state/render/input.rs:251`; `main.rs:34`. `setup/detection.rs:38` shows the correct `spawn_blocking` pattern. | Wrap in `spawn_blocking`. |
| B-11 | Reliability | Settings file written on every arrow keypress in `/config` — synchronous `fs::write` + `fs::rename` per key-repeat event, on the event-loop thread. | `apps/netscli-cli/src/tui/state/config_ui.rs:114` → `tui_settings.rs:104-120`. | Debounce, or save on panel close. |
| B-12 | Correctness | TUI `/pcap` rejects interfaces the core would resolve — exact string equality against device names, while `resolve_capture_device` supports case-insensitive, description-substring, GUID, and IP matching. The CLI has no such pre-check, so the two surfaces disagree. | `tui/events/pcap.rs:157` vs `crates/netscli-core/src/pcap/device.rs:7-36`. | Delete the pre-check and let core resolve. |
| B-13 | Data loss | `/export` silently overwrites any path with no confirmation and no `--force`, and `create_dir_all` materialises arbitrary directory trees. `/export -o ~/.bashrc` clobbers it. The sibling write path (`tui_settings.rs`) is careful enough to do tmp+atomic-rename. | `apps/netscli-cli/src/tui_export.rs:75-90`. | Prompt on existing files, or require `--force`. |
| B-14 | Correctness | Dependency↔command pairing is index-based against non-parallel lists. `recommend_commands()` returns one entry covering both deps, so with libpcap and tcpdump both missing the user is prompted twice and the same command runs twice. | `apps/netscli-cli/src/setup.rs:69-84`. | Pair explicitly, or dedupe commands before prompting. |
| B-15 | Reliability | Unhandled promise rejection on the progress-event subscription — no `.catch`. If Tauri's `listen()` rejects, every subsequent operation silently loses progress with no user signal. Every other Tauri call in the codebase is guarded. | `apps/netscli-gui/src/workspace/useWorkspace.ts:118-137`. | Add `.catch` with a toast. |
| B-16 | Correctness | Switching tabs wipes the destination tab's row selection — the effect deps track `activeTab?.sortKey`, not tab identity, and each tool kind has a different `DEFAULT_SORT`. | `workspace/useWorkspace.ts:109-116`; defaults at `tools/registry.ts:186-199`. | Key the effect on `activeTabId` and compare previous sort state. |
| B-17 | Correctness | `setActiveTabId` called inside a `setTabs` updater. React requires updaters to be pure; StrictMode double-invokes them in dev and concurrent rendering may replay them. Works today only because the call is idempotent. | `workspace/useTabLifecycle.ts:69-78`; StrictMode at `main.tsx:7`. | Compute the replacement id outside the updater. |
| B-18 | Performance | Global keydown listener torn down and re-attached on every render — deps include a fresh object and two fresh closures, and a 3-second stats poll re-renders `App` continuously. | `hooks/useKeyboardShortcuts.ts:113-126`; poll at `workspace/useNetworkStatus.ts:15,142`. | Wrap handlers in `useCallback`/`useRef`. |
| B-19 | Reliability | "Copied" toast shown even when the clipboard write failed — `.catch(() => undefined)` swallows the rejection and the optional chain makes a missing `navigator.clipboard` a silent no-op. Both still report success. | `workspace/useResultActions.ts:97-107`. | Report failure, as the export path already does at `:48-51`. |
| B-20 | Accessibility | Result grid ARIA is structurally invalid and state is unannounced: `role="grid"` on a `div` whose only child is a `table` (breaking row ownership), no `aria-sort` on sortable headers, no `aria-activedescendant` for arrow-key navigation. Zero occurrences of either attribute repo-wide. | `components/results/ResultTable.tsx:103-110, 118-125, 146-156`. | Put `role="grid"` on the `table`, add `aria-sort` and `aria-activedescendant`. |
| B-21 | Accessibility | Toasts are never announced — no `role="status"`, `role="alert"`, or `aria-live` anywhere in the GUI. Operation-complete and operation-**failed** notifications are silent for screen-reader users. | `components/shell/ToastHost.tsx:16-44`; zero `aria-live` repo-wide. | Add `role="status"` (or `alert` for errors). |
| B-22 | Usability | Native context menu suppressed document-wide, including inside text inputs. The app's own context menu only covers result surfaces, so right-clicking any form field yields nothing — users lose the only mouse-driven cut/copy/paste affordance. | `hooks/usePopoverDismissal.ts:14-21` (unconditional `preventDefault`); app menu scoped at `App.tsx:144`. | Exempt `input`/`textarea`/`contenteditable`. |
| B-23 | Maintainability | **Site CSS override stack is structurally unmaintainable:** 28 files, 4,854 lines, **1,214 `!important`** (~25% of all lines), and **149 selector+property keys declared in more than one file with different values in the same media context**, resolved purely by load order. Filenames (`-closeout`, `-final`, `-guardrails`, `-correction`, `-verified`, `release-qa-overrides`) are a chronological QA log, not a structure. No rule can be changed by editing the file that appears to own it. | `site/src/styles/starlight/*.css`, ordered at `astro.config.mjs:32-61`. E.g. `.right-sidebar-container { display }` under `max-width:71.99rem` is set `none!important` in file 03 then `block!important` in 12, 14, and 17. `01-tokens-and-header.css` defines tokens, yet file 11 hard-codes `#007a54` over them. **Contrast:** the GUI's 20 stylesheets contain **1** `!important` total. | Consolidate to one file per component concern; delete contradicting duplicates; route colors through the tokens that already exist. |
| B-24 | Correctness | **Two sitemaps ship, and `robots.txt` advertises the stale one.** `dist/` contains `sitemap.xml` (hand-written passthrough, all 13 `lastmod` frozen at `2026-07-02`), plus Starlight-generated `sitemap-index.xml` and `sitemap-0.xml`. `robots.txt` points at `/sitemap.xml`; the always-accurate generated index is never referenced. | `site/public/sitemap.xml`; `ls dist/sitemap*.xml` shows all three; `diff public/sitemap.xml dist/sitemap.xml` → identical. `@astrojs/sitemap` is a declared dependency of `@astrojs/starlight` and auto-registers (verified via its `package.json`), which is why it runs despite not appearing in `site/package.json`. | Delete `public/sitemap.xml` and point `robots.txt` at `/sitemap-index.xml`. |
| B-25 | Correctness | 404 page is self-canonicalised and indexable: `canonicalPath="/404.html"` emits `<link rel="canonical" href="https://netscli.com/404.html">`, no `<meta name="robots">` exists anywhere in `site/src`, and `robots.txt` is `Allow: /`. It also emits full `og:*`/`twitter:*` metadata. | `site/src/pages/404.astro:10`; `src/layouts/Page.astro:87`. | Add `noindex` and drop the canonical. |
| B-26 | Test coverage | a11y gate covers 7 of 14 routes. Unscanned: `/docs/cli/`, `/mcp/`, `/tui/`, `/operations/`, `/packet-capture/`, `/core-library/`, `/result-model/` — which hold the heaviest table markup, and `docs-header.ts:298-323` injects table wrappers at runtime on every docs page. | `site/scripts/a11y.mjs:9-17`. The check itself is rigorous (`wcag2a,wcag2aa,wcag21a,wcag21aa`, `--exit`, exit code propagated at `:112`). | Enumerate routes from the build output rather than hard-coding. |
| B-27 | Test coverage | **Zero React component or hook tests.** Devdeps have `vitest` but no `@testing-library/react` or DOM environment. All 10 test files target pure modules against 87 source modules. Untested: `useWorkspace`, `useTabLifecycle`, `useResultActions`, `focus.ts` (the focus trap), and every `.tsx`. A-13, B-16 and B-17 all live in this uncovered band. | `apps/netscli-gui/package.json:25-36`. | Add `@testing-library/react` + `jsdom` and cover the workspace hooks first. |
| B-28 | Reliability | e2e depends on live public DNS — `exerciseDns` runs a real `ALL`-record lookup against `netscli.com` with a 25 s budget. Every other scenario is hermetic against the local probe server. | `e2e/tauri-render/scenarios/tools.mjs:12, 29`. | Point it at the probe server or a `.test` name. |
| B-29 | Reliability | Partial-publish and non-idempotent re-runs. Four scripts push to three repos with no coordination: if Homebrew succeeds and Scoop fails, the tap advertises 0.3.0 while the bucket stays on 0.2.6. `git commit` aborts under `set -e` when there is nothing to commit, so re-running a channel — the documented recovery path — fails. | `publish-homebrew.sh:90-91`, `publish-scoop.sh:55`; recovery documented at `docs/RELEASE.md:114-116`. Also `publish-scoop*.sh:22-28` inline the poll loop without the `return 1` its Homebrew sibling has. | Make each script idempotent (`git diff --quiet \|\| git commit`) and add push retry. |
| B-30 | Security | `GH_TOKEN` embedded in the git remote URL in all four publish scripts, landing in `.git/config` and potentially in git's error output on failure. | `publish-homebrew.sh:52-54`, `publish-homebrew-cask.sh:52-54`, `publish-scoop.sh:34-36`, `publish-scoop-gui.sh:34-36`. | Use `http.extraheader` or a credential helper. |
| B-31 | Correctness | `docs/PUBLISHING.md` version-bump procedure is factually wrong and reintroduces the v0.2.6 bug. It claims crates "share a version (inherited from the workspace)" — root `Cargo.toml`'s `[workspace.package]` has **no `version` key**, so the documented `sed` no-ops. The file list also omits `src-tauri/Cargo.toml`, `package.json`, and `tauri.conf.json` — the exact defect a Winget moderator caught at v0.2.4. | `docs/PUBLISHING.md:71, 76-78`; root `Cargo.toml:11-20`; incident at `CHANGELOG.md:89-99`. Same false claim repeated at `CHANGELOG.md:7-8`. | Either add a workspace `version` and `version.workspace = true`, or fix the doc's file list. |
| B-32 | Correctness | Homebrew Cask `zap` targets the wrong bundle id — `com.netscli.app` vs the actual `com.netscli.gui`. `brew uninstall --zap` leaves all app data behind, and the bug is baked into the generator so it survives every release. | `packaging/homebrew/Casks/netscli.rb:31-33`; generator at `publish-homebrew-cask.sh:86-88`; real id at `tauri.conf.json:5`. | Fix both. |
| B-33 | Security | Dev PowerShell scripts default a linker input path to `C:\tmp\netscli-npcap-sdk` — a predictable, non-ACL'd location any local user can populate. A planted `Lib\x64\wpcap.lib` passes the existence check and links into the developer's build. `docs/RELEASE.md:72-75` steers maintainers here during the release gate. | `scripts/dev-gui-pcap.ps1:11,30-31`; `scripts/test-pcap.ps1:11,30-31`. | Default to a path under `$env:LOCALAPPDATA`, or require `NPCAP_SDK` explicitly. |
| B-34 | Supply chain | `cargo install tauri-driver --locked` is unpinned — `--locked` honours that crate's lockfile but the *version* floats to whatever is newest at job time. | `.github/workflows/gui-render.yml:52`. | Add `--version X.Y.Z`. |
| B-35 | Coverage | **Dependabot does not cover `site/`.** Ecosystems configured: cargo `/`, cargo `/scripts`, npm `/apps/netscli-gui`, github-actions `/`. The Astro site has its own `package.json` and lockfile and receives no updates. | `.github/dependabot.yml`; `site/package.json` exists and `site/.gitignore` is tracked. | Add an npm entry for `/site`. |
| B-36 | Performance | Render function mutates state and clones all history per frame: `spinner_frame()` increments state from the draw path (coupling spinner speed to frame rate), and every history entry's output is cloned on every draw at ~10 fps. | `tui/state/render/content.rs:31, 51`; `render/input.rs:314-322`. | Drive the spinner from wall time; borrow rather than clone. |
| B-37 | Correctness | Windows adapter prefix mis-association — the first family-matching prefix is applied to *every* address on the adapter, so a multi-IP adapter reports all addresses with one (often wrong) mask. This is the exact hazard `common/network.rs:69-104` documents and defends against; the defence wasn't applied here. | `crates/netscli-core/src/arp/platform/interfaces.rs:78-85`. | Match each address to its own prefix. |
| B-38 | Maintainability | Three never-disconnected whole-document `MutationObserver`s on every docs page, each with rAF callbacks that themselves mutate the DOM, plus 8 scroll/resize listeners, none removed. | `site/src/scripts/docs-header.ts:125-131, 191-196, 248-252`. Loops are prevented by guards, but the cost is permanent. | Scope observers to the specific containers; disconnect on `astro:before-swap`. |
| B-39 | Documentation | `docs/SECURITY_REVIEW.md` excludes the entire supply-chain surface and is 11 weeks stale with no re-verify cadence. Release/publish scripts, packaging manifests, installer templates, and CI workflows have never had a security review. Its dependency conclusion rests on `npm audit --omit=dev`, which excludes the build toolchain that produces the shipped bundle. | `docs/SECURITY_REVIEW.md:3, 5, 136, 151-152`. | Extend scope to CI/packaging and add a review cadence. Note its F-01..F-07 remediations were independently verified as genuinely applied (see Strengths). |

### Low

Condensed; each is CONFIRMED with a cited line unless marked.

- **C-01** `Instant - Duration` can panic near boot — `stats.rs:49,76`; use `checked_sub`.
- **C-02** Unchecked `+=` accumulation across interfaces — `stats.rs:198-199`; panics in debug on overflow.
- **C-03** CLI table widths computed in bytes, padded in chars — `cli_formatter/discover.rs:39-58`; and no value truncation, so one 200-char hostname breaks every row.
- **C-04** pcap table `fit_cell` uses char count and `packet.info` is width-unbounded — `cli_formatter/pcap.rs:66, 74-86`.
- **C-05** `netscli doctor` writes to disk as a side effect of a read-only query — `setup.rs:144-148`.
- **C-06** `parse_file` walks an entire multi-GB capture after hitting `max_packets` — `pcap/parse.rs:15-31`.
- **C-07** Dead code: `interface_preference_rank` never returns its middle value (`common/network.rs:38-47`); `.take(ENRICH_MAX_BYTES)` on a byte-capped input is a no-op (`probes/mod.rs:72`); lenient `parse_ports` still publicly exported alongside the checked variant (`lib.rs:25`).
- **C-08** Comment overclaims a fix — `discover.rs:94-102` says a race is removed, but `fetch_add`+`load` remain two operations.
- **C-09** MCP: `{"id": null}` is silently treated as a notification and gets no response (serde maps explicit `null` to `None`) — `server.rs:74`. Missing `jsonrpc` yields `-32700` rather than `-32600`; batch requests unsupported.
- **C-10** MCP `clamp_concurrency` caps at 4096 while `Ops::new` re-clamps to 1024, so 1025–4096 are silently reduced; the comment at `ops/config.rs:33-37` claiming the bounds "match" is wrong.
- **C-11** `externalLink` sets `link.href` with no validation; every caller inside `appendInline` passes `safeHref(...)`, but `release-list.ts:86-87` passes `release.html_url` straight from the GitHub API — `markdown-inline.ts:19-28`. Defence-in-depth only.
- **C-12** React key collision in `DetailList.tsx:5` — `${label}-${value}` duplicates for two identical TXT records.
- **C-13** Detail-pane "tabs" have no tab semantics (no `role="tablist"`/`tab`/`tabpanel`) — `DetailPane.tsx:106-111`. The landing page does this correctly at `landing-page.ts:148-161`.
- **C-14** `formatNumber` duplicated verbatim in 4 files — `rowDetails.ts:163`, `summaries.ts:50`, `traceLine.ts:86`, `rows.ts:251`.
- **C-15** Dead form field `DEFAULT_FORM.mdns.timeout_ms` has no UI and is read without clamping — `tools/registry.ts:180` vs `:133-141`, `toolExecution.ts:107`.
- **C-16** Progress detail miscounts port ranges — `countList` splits on `,` only, so `1-1024` reports "1 ports" — `OperationProgress.tsx:104-106`.
- **C-17** OS detection defaults to macOS, and Intel Mac visitors get an ARM-only `.dmg` from the hero button — `landing-page.ts:190-193, 211-216`; both arches are published (`release.yml:224,229`) and the Cask branches correctly.
- **C-18** Windows install docs offer strictly fewer paths than the landing page (no Scoop, no `install.ps1`) — `site/src/content/docs/docs/install.md:11-33` vs `site-content/install.ts:11-29`.
- **C-19** Docs dependency diagram omits the CLI→MCP edge that makes `netscli serve` work — `core-library.md:22-27` vs `apps/netscli-cli/Cargo.toml:28`.
- **C-20** `apps/netscli-gui/index.html:5` references `/vite.svg`, but `public/` does not exist — a 404 in the webview, default Vite placeholder still present.
- **C-21** `"build": "tsc && vite build"` does not build project references, so `tsconfig.node.json` (covering `vite.config.ts`) is never typechecked — `package.json:9`; needs `tsc -b`.
- **C-22** No ESLint config or lint script anywhere in the GUI — `package.json`. `AGENTS.md:171` acknowledges this.
- **C-23** `crates/netscli-core/README.md:35` example does not compile — `parse_ports("22,80,443")?` against `fn parse_ports(Option<&str>) -> Option<Vec<u16>>`, and `?` on an `Option` in an `anyhow::Result` fn.
- **C-24** `apps/netscli-cli/README.md:44` documents `NETSCLI_PCAP=1 curl … | bash`, which scopes the variable to `curl`; `bash` never sees it and silently installs the non-pcap build.
- **C-25** `release-drafter` runs on every PR event holding `contents: write` with no autolabeler configured, so the runs accomplish nothing; `version-resolver` therefore defaults to `patch` and would have proposed v0.2.7, not v0.3.0 — `.github/workflows/release-drafter.yml:6-11`, `.github/release-drafter.yml`.
- **C-26** `docs/RELEASE.md` contradicts itself on publish-job count (`:108` says 5, `:123-127` describes 4 more).
- **C-27** `target-pcap/` (set by `dev-gui-pcap.ps1:33`) is not gitignored — a multi-GB tree appears untracked during the documented Windows workflow.
- **C-28** `.gitignore:25` `*.csv` is repo-wide and would swallow legitimate CSV fixtures; `:76` is a dead negation.
- **C-29** WiX declares a feature titled "PATH Environment Variable" containing no `<Environment>` element — `wix/main.wxs:251-261`; the installer UI advertises an option that does nothing.
- **C-30** CHANGELOG: 0.2.1 dated 2026-04-30 but tagged 2026-05-03 (`:247`); claims Keep a Changelog conformance while using non-standard sections (`:3-4`); MCP tool count internally inconsistent across `apps/netscli-cli/README.md:26` and `CHANGELOG.md:403, 300-308`.
- **C-31** Result filter is workspace-global rather than per-tab, so a filter carries across tab switches — `useWorkspace.ts:27, 45-48`. May be intentional.
- **C-32** Duplicate `App.css` import and non-null assertion — `main.tsx:4, 6`.
- **C-33** Stale doc examples: `docs/RELEASE.md:22-23` (v0.2.1), `packaging/winget/README.md:43-45` (0.1.1), `packaging/aur/README.md:32,48` (0.1.1/0.1.2).
- **C-34** Formula and Cask share the token `netscli` in one tap, making `brew install netscli` ambiguous — `packaging/homebrew/netscli.rb:12` vs `Casks/netscli.rb:12`.
- **C-35** `packaging/README.md:9-10` says publish jobs "compute" SHA256s; they read a sidecar. Ties to B-03.
- **C-36** `generate-oui.rs:32` truncates every MA-M/MA-S assignment to a 24-bit prefix, attributing a whole /24 OUI block to one holder of a fraction of it; `:128-136` slices `&hex[0..2]` without ASCII-hex filtering, panicking on a non-ASCII first token.

---

## 5. Unconfirmed / Requires Investigation

| # | Suspicion | Why unconfirmed | To confirm |
| --- | --- | --- | --- |
| U-01 | Windows `ping -a` reverse-resolution bypasses hickory's escaping — `dns/reverse.rs:92-118` parses hostnames from raw `ping` stdout via `split_whitespace().last()`, which does not remove `ESC`/`BEL`. | Depends on whether the Windows LLMNR/NetBIOS resolver will surface a name containing control bytes. | Craft a LLMNR responder with a control-char name on a Windows LAN. |
| U-02 | Scoop GUI manifest uses `installer.type: msi`, which Scoop deprecated, and declares a shortcut relative to the Scoop app dir while the MSI installs per-machine to `C:\Program Files\NetsCLI\`. | Needs a real `scoop install netscli-gui`; `packaging/scoop/README.md:26-27` admits this is unvalidated. | Run the install on a Windows host. |
| U-03 | `docs/RELEASE.md:44` smoke-test path `C:\Program Files\NetsCLI\netscli-gui.exe` conflicts with `packaging/scoop/netscli-gui.json:17`'s `NetsCLI.exe`. Because the harness *skips its own build* when `TAURI_APP_PATH` is set, a wrong path may turn the smoke test into a silent no-op. Similarly `:52`'s registry check targets a key the WiX template never writes. | Requires building the MSI. | Build and inspect the bundle. |
| U-04 | `packaging/aur/PKGBUILD:11` `depends=('gcc-libs' 'glibc')` may be wrong if the shipped Linux asset is the static-musl variant. | Asset↔PKGBUILD mapping not traced end to end. | Check which asset URL the PKGBUILD's `source_x86_64` resolves to. |
| U-05 | `site/scripts/a11y.mjs:103-106` has no `axe.on('error')`, so a missing binary would hang until the CI job timeout rather than failing fast. | Would need to delete the binary and run. | Add the handler regardless — it is free. |
| U-06 | `docs-header.ts` listens for `astro:page-load` while also being invoked once from `Header.astro:61-62`; if view transitions are ever enabled, the three observers stack per navigation. | View transitions are not currently enabled. | Re-check if `ClientRouter` is ever added. |
| U-07 | Whether `--features pcap` currently passes `clippy -D warnings` and its tests. | No Npcap SDK on the audit host. | Run `scripts/test-pcap.ps1` on a machine with the SDK. |

**Resolved cross-check:** one reviewer flagged that `pcap/tests.rs` has no malformed-packet coverage but could not assess whether `summarize_packet` panics. I read `pcap/protocols.rs` directly: every parse uses `let Some(p) = XxxPacket::new(data) else { … return }` (pnet returns `None` on short buffers), `summarize_raw_ip` guards `data.is_empty()` before indexing `data[0]`, and `hex_preview` uses `.take()`. **It is panic-free on truncated input.** The test gap is real; the implementation is sound.

---

## 6. Summary

### Strengths

1. **The safety-limit architecture is real and tested at the interface boundaries.** `/16` subnet cap (`ops/validation.rs:5`), 4,096-port cap (`common/ports.rs:4`), concurrency clamped to `[1,1024]` (`ops/config.rs:37`), probe reads bounded to 4 KiB with 150–1200 ms timeouts (`probes/mod.rs:11,13-15`), HTTP headers capped at 32 (`http.rs:73`), and bounded PCAP defaults (`ops/pcap.rs:92-122`). `tests/config_safety.rs` pins the clamping behaviour; `mcp_stdio.rs` pins the *reasons* requests fail (`-32002` "Not initialized", `-32602` "subnet too large", `-32602` "port 0") rather than just pass/fail.
2. **The prior internal security review's remediations were genuinely applied.** I independently verified all seven: F-01 port cap exists, F-02 `export_text_file` rejects renderer-supplied paths (`files/export.rs:23-28`), F-03 pcap output is `.pcap`-only and backend-owned, F-04 the opener capability is scoped to one GitHub URL (`capabilities/main.json:13-19`), F-05 history has a privacy toggle, F-06 `NETSCLI_DNS_FALLBACK=off` works with a local-suffix skip list, F-07 `style-src 'unsafe-inline'` is gone (`tauri.conf.json:29`). This is unusually good follow-through.
3. **Type safety in the GUI is airtight.** A repo-wide grep for `any`, `@ts-ignore`, `as unknown as` across 87 modules returns exactly one hit — in a test fixture. The one genuinely untrusted `invoke()` result is typed `unknown` (`services/netscli.ts:187`) and validated through `parseResultBundle` (`transfer.ts:64-95`) for schema, kind, payload shape, and form shape.
4. **The concurrent-operation race was anticipated, implemented, and tested.** `workspace/operations.ts:59,90,99-101` guards success and failure paths with `activeOps.current[tab.id] !== opId`, tab closure funnels through `cancelOperationIds`, and `operations.test.ts:26-105` explicitly covers "ignores a stale resolution once a newer run has started."
5. **No HTML-injection sink exists for attacker-influenced scan data.** Exhaustive grep for `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`/`document.write` across the GUI returns zero. The changelog renderer builds DOM with `createTextNode`/`textContent` and routes every markdown href through `safeHref` (`markdown-inline.ts:10-17`).
6. **Defensive parsing throughout core.** ARP output parsing uses `let-else`, `.get(i+1)`, and length guards across all three platforms, with inline documentation of tolerated malformed variants (`arp/platform/table.rs:106-110`). `pick_ipv4_subnet_from_prefixes` carries four regression tests naming the real-world failure it prevents (`common/network.rs:77-104`).
7. **Comments explain *why* and cite the bug they fixed** — the `join_all` regression (`dns/lookup.rs:37-50`), the ping-reply misparse (`dns/reverse.rs:88-91`), the Mbps de-clamping rationale plus its test (`stats.rs:204-215`), the `PortScanner` shared-semaphore rationale (`scan/tcp.rs:16-22`), and the `vite.config.ts:5-19` fix for the v0.2.6 version-drift bug.
8. **CI gates what `AGENTS.md` claims.** `cargo fmt --check`, clippy with and without `pcap` at `-D warnings`, a 3-OS test matrix, the file-size guard, GUI unit tests + typecheck + build, and shellcheck/PSScriptAnalyzer on both installers. `pages.yml` is confirmed `workflow_dispatch`-only and byte-identical to `origin/main`.
9. **e2e asserts behaviour, not pixels** — command-preview regexes, status-bar counts, all four detail tabs, syntax-highlight token counts, filter round-trips, exact menu-label lists, and computed background luminance for theme checks. Failure handling dumps a screenshot plus body text plus every `data-testid` value, and tears down in `finally`.
10. **GUI CSS discipline is exemplary** — 20 stylesheets, **one** `!important` total, 10 hard-coded colors against 55 token definitions. It stands in deliberate and instructive contrast to the site's 1,214.

### Key Risks

**Release integrity is the weakest link in an otherwise well-signed pipeline** (A-05, A-06, A-07, A-08, B-03, B-04). cosign signatures are produced correctly but consumed by nobody: the installers do not check them, the packaging scripts do not check them, and the one verify command most people will read is scoped loosely enough to accept any workflow in the repo. Meanwhile the checksums that *are* checked are fetched from the same origin as the artifact, so they detect corruption but never compromise; the Windows pcap build links an unverified third-party download; and every action holding `id-token: write` is tag-pinned. Individually each is a hardening gap. Together they mean a signature on a netscli release currently attests less than it appears to.

**The repository claims a release that does not exist** (A-04, A-10, B-31). Every manifest says 0.3.0; git, crates.io, and GitHub Releases all say 0.2.6. The concrete harm today is that `SECURITY.md` tells every real user their version is unsupported, `CHANGELOG.md` links a 404, and the winget 0.2.6 manifests have been overwritten with 0.3.0 content that would file a conflicting catalog PR. The documented version-bump procedure is also wrong in exactly the way that caused a past moderator rejection.

**Untrusted network data reaches the operator's terminal unescaped** (A-02, A-03, B-09). A hostile DNS server or any device on the LAN can inject ANSI/OSC sequences into `netscli dns` / `netscli mdns` output. For a security tool whose value rests on the operator trusting what it prints, output forgery matters more than it would elsewhere. The codebase already has the right primitive and applies it in one place; it simply is not wired to the other sources. The TUI and JSON/YAML paths are structurally safe — this is specifically the plain-text CLI.

**The MCP server cannot serve an agent under load** (A-01). Sequential request handling means a single `sweep_network` blocks every subsequent call including cancellation — empirically confirmed. This is the interface the project was built for first.

**Two areas have no test coverage at all where the bugs actually are**: React hooks and components (B-27 — A-13, B-16, B-17 all live there), and terminal-output escaping (no test anywhere feeds a control character through a formatter, which is precisely the A-02/A-03 hole).

**Site CSS is at the point where change is unsafe** (B-23). 149 same-context contradictions resolved by load order across 28 files named for the QA pass that produced them means no edit is locally reasonable.

### Priority Order

1. **Fix the release-state inconsistency** (A-04, A-10, B-31). Cheapest, highest clarity: decide whether 0.3.0 ships or reverts, correct `SECURITY.md`, restore the winget 0.2.6 manifests. Everything downstream depends on knowing what version this is.
2. **Close the terminal-injection paths** (A-02, A-03, B-09). One shared `sanitize_for_terminal` applied at the `cli_formatter`/`commands.rs` print sites closes all three. Add a test that feeds `\x1b[31m` through a formatter.
3. **Harden release integrity** (A-05, A-06, A-08, B-03, B-04). Pin the Npcap SDK hash, fail installers closed on a missing sidecar, quote the heredoc and validate `TAG`, re-hash assets in the publish scripts, unify the cosign regex. These are small, independent edits with large blast radius.
4. **Bump the audited dependencies** (A-12) and add `site/` to Dependabot (B-35). `quick-xml` is two High advisories and the fix is a version bump.
5. **Make the MCP server concurrent** (A-01). Larger change, but it is the project's stated primary interface and the fix is well-understood (spawn per request, write through a channel).
6. **SHA-pin the release/publish actions** (A-07). Mechanical, and it is what makes step 3 actually hold.
7. **Fix the GUI state bugs and add hook tests** (A-13, B-15, B-16, B-17, B-19; then B-27). Add `@testing-library/react` first so the fixes land with coverage.
8. **Repair `setup --execute`** (A-11, B-14) — it is currently broken on two of three platforms.
9. **Panic and correctness fixes in core** (B-06, B-01, B-02, C-01, C-02, C-36) — each is a few lines.
10. **Unicode width handling in the TUI** (B-07, B-08, C-03, C-04) — one shared width helper already exists; use it.
11. **Accessibility** (B-20, B-21, B-22, C-13) — the focus traps and menu ARIA are already excellent, so this is finishing work, not a rebuild.
12. **Consolidate the site CSS** (B-23) and fix the sitemap/404 SEO issues (B-24, B-25). Largest effort, lowest urgency — defer until the site's shipping status is settled.

### Coverage Gaps

**Not examined at all:**
- Binary assets: all icons, screenshots, and `crates/netscli-core/data/oui.min.json.gz` (the shipped dataset's *contents* were never validated — relevant to A-09).
- `Cargo.lock` and both `package-lock.json` files beyond a skim for unexpected registries.
- `apps/netscli-gui/src/services/appWindow.ts`; `site/src/data/site-content/{faq,footer,surfaces,types}.ts`; `site/src/scripts/nav-scroll.ts`; `site/ec.config.mjs`.

**Examined only by targeted grep, internal logic unreviewed:**
- 15 GUI shell/results components and all of `components/tools/` (grepped for injection sinks, ARIA roles, `style=`/`href=` — all clean).
- 15 of 18 `tools/presentation/*.ts` modules (~1,900 lines) — checked for duplication and injection only; their row-building, filter-tokenising, and CSV-serialisation correctness is unreviewed.
- 8 of 12 e2e files including all `scenarios/helpers/`.
- 6 `site/src/components/*.astro` and all `components/starlight/*.astro` — markup and a11y unreviewed.
- 4 of 11 docs pages (`operations`, `packet-capture`, `core-library`, `result-model`) — version/command claims spot-checked, other factual claims unverified.
- 6 TUI formatter modules and `tui/{command_catalog,palette}.rs` — structurally identical to reviewed siblings, and ratatui's control-char filter (`buffer.rs:349-350`) makes the injection risk there materially lower.
- All 48 CSS files were parsed programmatically for `!important` counts, token usage, and cross-file contradictions, not read prose-first. The 149-contradiction figure is a lower-confidence floor: the parser cannot resolve `:where()` specificity subtleties.

**Could not be checked (tooling/platform):**
- The entire `pcap` feature under lint and test (no Npcap SDK) — ~800 lines including `pcap/protocols.rs`, which I read but could not exercise.
- Unix code paths in `arp.rs`, `ping.rs`, `trace.rs`, and `.deb`/`.dmg`/`.AppImage` bundling (Windows-only host).
- The Tauri render e2e suite and the site a11y suite (both need a browser/driver stack not present).
- Whether the installers actually work end to end — `install.sh`/`install.ps1` were read, never executed.

**Types of testing not performed:** load/stress testing, fuzzing (notably of `pcap/protocols.rs` against malformed frames and of the MCP JSON-RPC surface), penetration testing, and any dynamic analysis. All "CONFIRMED" ratings above rest on source inspection plus dependency-source verification, except A-01 and A-04, which were confirmed by live execution.

**Information unavailable:** production telemetry, real download/usage numbers, GitHub Actions run history, Dependabot alert state, and the contents of the `wip/fingerprint-scan-history` branch (out of scope by instruction).
