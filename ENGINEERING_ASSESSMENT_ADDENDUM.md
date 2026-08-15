# NetsCLI — Assessment Addendum (Step 3: closing the coverage gaps)

**Date:** 2026-08-14
**Base:** `main` @ `adbb368`
**Purpose:** close the "not examined" section of `ENGINEERING_ASSESSMENT.md` by reading the ~70 modules the first pass only grepped, and correct two errors in that assessment.

---

## 1. Corrections to the original assessment

| Original claim | Correction |
|---|---|
| "The entire `pcap` feature was never linted or tested" | **Wrong as stated.** CI runs `clippy --all-targets --features pcap -D warnings` and pcap tests for `netscli-core` and `netscli-mcp` on Linux (`ci.yml:165,205,209`). The gap was in *my local* verification, not the project's coverage. |
| "All Unix code paths untested" | **Wrong as stated.** The test matrix is ubuntu + macos + windows (`ci.yml:175`). Last `main` run: success. |
| "Dependabot does not cover `site/`" | **Wrong.** `/site` is covered — PRs #150, #156, #157 are all `/site`. |
| e2e process leak rated **Critical** by the reviewing agent | **Downgraded to Medium.** GitHub runners are ephemeral VMs, so orphaned processes die with the job. Real impact is local dev — which bit this session as an `EPERM: unlink rolldown-binding…node` from a stray node process holding a file lock. |

**A real gap that survives:** `cargo test --features pcap` covers `netscli-core` and `netscli-mcp` but **not `-p netscli`**, so the pcap CLI dispatch path in `cli_dispatch/pcap.rs` is clippy-checked but never test-run.

---

## 2. High severity

### H-1 · The site promises packet capture in 14 files and never says how to get a build with it
**CONFIRMED — verified directly.**

`grep -rniE "NETSCLI_PCAP|--features pcap|-pcap\b" site/src/` returns **zero matches**. Meanwhile packet capture is referenced across 14 files including a 6-step "Desktop Behavior" workflow (`packet-capture.md:68-81`).

Reality:
- `release.yml:212` — "GUI installers intentionally do not pass `--features pcap`". Every desktop installer the site links is pcap-less.
- `apps/netscli-cli/Cargo.toml:38` — `default = []`, so `cargo install netscli` has no pcap.
- The three ways to actually get it (`NETSCLI_PCAP=1`, the `netscli-*-pcap` release asset, `--features pcap`) appear nowhere on the site.

Every visitor who installs from netscli.com gets a build where the documented packet-capture workflow cannot run, with no explanation.

### H-2 · `netscli pcap --check` is documented as the capability check but doesn't exist on default builds
**CONFIRMED — verified directly.**

`packet-capture.md:22-26` instructs users to run it. `args.rs:225-226` gates the entire `Pcap` variant behind `#[cfg(feature = "pcap")]`, so on a default build clap errors with "unrecognized subcommand". `netscli doctor` is the command that works on every build and isn't mentioned.

### H-3 · Workspace tabs are unreachable by keyboard
**CONFIRMED — verified directly.**

`TabStrip.tsx:212-231` renders each tab as a plain `<div onClick>`. `grep -nE "tabIndex|role=" components/shell/TabStrip.tsx` → **no matches**. And `useKeyboardShortcuts.ts` binds Ctrl+F, Ctrl+K, Ctrl+A, Escape, Enter, c/d/r — **nothing for tab switching**. With more than one tab open there is no keyboard path to change tabs at all.

### H-4 · Four e2e result assertions pass on zero
**CONFIRMED — verified directly.**

`tools.mjs:62` `/\d+ hosts?/i` matches `"0 hosts"`. Same shape at `:73` (sweep), `:83` (interfaces), `:94` (ARP). A total backend regression in Discover/Sweep/ARP would still go green. Only `exerciseInspect` (`:46`, `/1 port checked - 1 open/`) pins a real value.

### H-5 · e2e pcap scenario cannot fail
**CONFIRMED (relayed).** `tools.mjs:104-115` returns `false` and passes if the Packet Capture menu item is *absent* or the pane renders an unavailable state. The pcap surface vanishing entirely is indistinguishable from a healthy skip.

---

## 3. Medium severity

### GUI components
- **M-1 · Duplicate React keys in History menu.** `MenuBar.tsx:365` `key={item.label}` where the label is `HH:MM  <command>` (`:386-390`). Two identical commands in the same minute collide — React can reuse the wrong element, so clicking one entry replays another. *Verified.*
- **M-2 · Column-resize keyboard handler reads the wrong width.** `resultTableInteractions.ts:59` writes `columnWidths` state but reads the static `column.width` prop, so one ArrowRight after a pointer resize snaps the column back. `startColumnResize:85` reads live DOM width — the two paths disagree.
- **M-3 · `NumberField` re-clamps on every keystroke.** `NumberField.tsx:46` clamps in `onChange`, so typing `300` into a max-255 field rewrites mid-word and 3-digit values with a too-large prefix are unreachable. Clamping belongs on blur/Enter, which already call `commit`.
- **M-4 · No client-side validation for `host`/`ports`/`subnet`/`filter`.** Numeric fields are properly bounded via `registry.ts` + `clampNumber`, but free-text fields are gated only on presence (`toolExecution.ts:202`), and `subnet` isn't even `required`. `ports: "hello"` reaches the backend before erroring.
- **M-5 · Menu bar is not a menubar.** `MenuBar.tsx:304` lacks `role="menubar"`, triggers lack `role="menuitem"`, and there's no ArrowLeft/Right traversal between menus.

### Presentation layer
- **M-6 · An apostrophe silently breaks the result filter.** `table.ts:75-83` opens quote mode on the first `'` or `"` and only closes on the match, so `vendor:o'brien lighting` never closes — whitespace splitting is disabled for the rest of the query and it merges into one token matching nothing. Apostrophes are realistic in vendor strings ("O'Brien", "Macy's"). *Verified by simulation.*
- **M-7 · Table and detail pane disagree on port latency.** `ports.ts:7 latencyOf` returns `''` for closed/error ports; `portDetails.ts:111 latencyOfPort` returns `'refused'`/`'-'` for the same input. Two formatters, two answers, same data. *Verified.*
- **M-8 · Three different expressions for "which ports did inspect check".** `rows.ts:131` uses `ports?.length ? ports : open_ports`; `columns.ts:16` and `summaries.ts:21` use `ports ?? open_ports`. If the backend returns `ports: []` with non-empty `open_ports`, rows render but the column set doesn't — every cell blank.

### Site
- **M-9 · Site nav is triplicated and has already drifted.** `Nav.astro:7-14`, `starlight/Header.astro:16-22`, `MobileMenuFooter.astro:11-21` each hardcode the links. Two live drifts: the mobile menu's `isActive` omits the `/changelog` branch, and the GitHub link is missing from the docs header.
- **M-10 · `OpsConfig` doesn't hold subnet size or port count.** `core-library.md:46` claims it does; `ops/config.rs:6-11` has exactly four timeout/concurrency fields. The subnet and port limits are private consts, not configurable.
- **M-11 · Docs sidebar may emit `<h2>`s before the page `<h1>`.** `starlight/PageSidebar.astro:84`. SUSPECTED — depends on Starlight's internal DOM order, unverified.
- **M-12 · `site/tsconfig.json:2-4`** sets `exclude: ["dist"]`, which replaces TypeScript's implicit default and pulls `node_modules` into the program via `**/*`. `skipLibCheck` blunts it. SUSPECTED.

### e2e
- **M-13 · Process teardown doesn't kill the tree.** `processes.mjs:70-74` is a bare `child.kill()`. On Windows the grandchildren — msedgedriver, the Tauri app, the WebView2 host — survive. *Verified.* Ephemeral CI limits the blast radius; local runs leak.
- **M-14 · ~⅓ of assertions pin pixel measurements.** `interaction.mjs:37` (`marginTop === '1px'`), `menu.mjs:147-149` (`checkboxWidth === '18px'`), `tabs.mjs:49-52`, `polish.mjs:66`. Font-metric and DPI dependent; binds the suite to one runner image and produces false reds on innocuous restyles.
- **M-15 · Real external DNS dependency.** `tools.mjs:12-18` resolves `netscli.com` against the runner's real resolver with a 25s budget. Any DNS outage or egress restriction turns it red for reasons unrelated to the GUI.
- **M-16 · Silent-skip paths.** `closeSettingsDialog` no-ops if `.settings-close` is missing (`menu.mjs:234-240`); `assertInterfaceReadinessReflectsSelection` early-returns on a single-healthy-NIC runner (`menu.mjs:196-205`), making it a no-op in CI.

---

## 4. Low / Info (condensed)

**GUI:** pointer capture leaked by column resize (`resultTableInteractions.ts:87`, while the sibling `detailPaneResize.ts:66` releases it correctly) · `dismissedWarningKeys` grows unbounded (`WorkspaceView.tsx:31`) · settings steppers ignore the in-progress draft (`SettingsControls.tsx:104`) · TabStrip overflow keyed on `tabs.length` so renames don't recompute · `MenuBar` restores focus via two competing mechanisms plus an uncleaned rAF *and* `setTimeout` (`:144-149`) · `AppFrame.tsx:14` double-click maximize fires on the window buttons too · `JsonPreview.tsx:13,38` key regex and classifier disagree · `StatusPill.tsx:11` interpolates a remote status into a CSS class, so a value with a space injects an extra class (no script execution; restyling only) · `NetworkInterfacePicker` and `SettingsSelect` are the same component twice, already diverged on Escape handling · `updateOverflowState` duplicated byte-for-byte in two files · `PcapUnavailableState.tsx:7` branches on a Rust error-message substring when the `compiled` boolean is right there.

**Presentation:** CSV doesn't quote a lone `\r` (`values.ts:15`) and joins with `\n` not CRLF · filter-hint generation strips quotes instead of escaping (`filterHints.ts:224`) · pcap command preview omits `--json` and interpolates the BPF filter unescaped (`commands.ts:45-50`) · ping RTT range formatted raw while the average goes through `formatNumber` (`rows.ts:42,46`) · `formatNumber` duplicated in four files · `proto: 'tcp'` hardcoded (`rows.ts:11`).

**Site:** two `<nav>` landmarks both labelled "Site navigation" · duplicate `aria-label="Code example"` regions · landing footer year is JS-filled and blank without JS while the docs footer computes it at build time · logo alt text inconsistent between the two headers · `download` attribute is a no-op cross-origin · module map omits `ping`/`trace`/`oui`/`common` · `db` feature-gating undisclosed.

---

## 5. What was verified accurate

Worth recording, because it's the larger share:

- **`result-model.md` is exceptionally accurate** — ~50 documented field names all match the Rust structs, including serde rename and optionality behaviour, across `PortResult`, `PcapPacketSummary`, `Host`, `DnsRecord`, `InspectResult`, `PingResult`, `MdnsService`, `SweepEntry`.
- **All four safety limits documented on the site are correct** — `/16`, 4096 ports, 256 concurrency, 500ms scan timeout, each traced to its constant.
- **Every CLI flag cited in the docs exists** with the stated name and default.
- **The 9-tool MCP count is right**, including the `mdns` default-on reasoning.
- **Every package-manager command in the FAQ has real publishing automation** behind it.
- **No XSS anywhere.** Zero `dangerouslySetInnerHTML`/`innerHTML` in the GUI; all seven `set:html` sites on the site trace to committed static content.
- **Sort comparators handle IPs correctly** — `table.ts:13-16` uses `localeCompare(..., {numeric: true})`; the classic lexicographic-IP bug is absent, verified by simulation.
- **Row building has uniform null discipline** — no `"null"`/`"undefined"` strings leak into the table or CSV.
- **Overlay/focus is genuinely centralised** — `useRovingFocus` and `useModalFocus` are real implementations reused by nine popovers.

---

## 6. Verdict on the e2e harness

**Worth repairing, but triage first — do not restore as-is.**

It is *not* a screenshot suite. It asserts exact menu contents, disabled-state matrices, command-string construction, tab lifecycle, clipboard behaviour and context-menu suppression, and its negative assertions (`doesNotMatch` on tab labels leaking raw CLI, version leaking into the footer) clearly encode specific bugs that were fixed once. That is worth keeping.

Three things make it a liability in current form: the process teardown leaks trees (M-13), a third of assertions pin runner-dependent pixel values (M-14), and several scenarios are structurally incapable of failing (H-4, H-5, M-16).

The fix is mechanical, not architectural: tree-kill teardown, demote cosmetic measurements to an opt-in "polish" run, pin the count regexes to real minimums, convert silent skips into explicit failures or explicit `--skip` flags. Roughly a day, against a suite that would take weeks to rebuild.

**Not exercised at all:** Ping, Trace Route, Reverse DNS, mDNS Discovery (menu-presence only), History replay, Copy/Export Selected actions, export file *contents*, the save-folder chooser, and every backend-failure path.

---

## 7. Coverage of this pass

**Read in full:** 27 GUI shell/results/tools components · 15 `tools/presentation/*` modules · 5 workspace modules · `services/appWindow.ts` · 12 e2e harness files · 6 landing `.astro` components · 4 Starlight override components · 4 docs pages · 4 `site-content` modules · `nav-scroll.ts`, `ec.config.mjs`, `tsconfig.json`.

**Doc claims verified against source:** `constants.rs`, `ops/validation.rs`, `ops/config.rs`, `common/ports.rs`, `scan/types.rs`, `pcap/types.rs`, `discover.rs`, `dns/types.rs`, `inspect.rs`, `ping.rs`, `sweep.rs`, `mdns.rs`, `trace.rs`, `lib.rs`, `netscli-mcp/src/server/tools.rs`, `args.rs`, all four `Cargo.toml` feature tables, `release.yml`, `publish.yml`, `install.sh`.

**Still not examined:** the CSS inside site components (the 28-file override stack remains the known B-23 finding) · the GUI's pcap-tab hiding logic · no `astro check` or build run during this pass, so M-11 and M-12 remain SUSPECTED.
