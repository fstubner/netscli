# NetsCLI Security Review

Date: 2026-05-29
Last re-verified: 2026-08-19
Next review due: 2026-11-19, and before any release that changes CI,
packaging, or the installer templates.

Scope: React/Tauri GUI, Tauri backend commands, `netscli-core`, CLI/TUI
dispatch paths, and MCP tool handlers. This review focused on frontend
injection/storage/URL risks, Tauri privilege boundaries, filesystem access,
network scan safety limits, DNS privacy behavior, PCAP capture behavior, and
dependency advisories.

### Out of scope, and why that matters

This review has never covered the supply chain. Not examined here:

- `.github/workflows/` — including `publish.yml`, which holds tokens for
  crates.io, the Homebrew tap, the Scoop bucket, winget and AUR.
- `scripts/release/` — the publish scripts that fetch release assets over
  the network and rewrite packaging manifests from them.
- `packaging/` — the manifests and installer templates themselves.
- `apps/netscli-gui/src-tauri/wix/` and `nsis/` — the installer templates.

That gap has produced at least one real finding since: until 2026-08-19 the
MSI used Tauri's `downloadBootstrapper` default, which fetched and executed
an installer over the network at install time, elevated, with no hash
pinning. Nothing in this document's scope would have caught it.

The dependency conclusion below also rests on `npm audit --omit=dev`, which
excludes the build toolchain that produces the shipped bundle. A compromised
bundler is a supply-chain risk this review does not measure.

Extending scope to the four areas above is tracked as B-39.

## Summary

The codebase has a good security baseline for a local network diagnostics tool: there are no obvious React raw-HTML or eval sinks, Tauri runs with an explicit capability file, network operations are centralized in `netscli-core`, core subnet size is capped, concurrency is clamped, and current Rust/npm dependency advisory checks are clean.

The main gaps were privilege-boundary and safety-policy issues rather than conventional web injection bugs. The findings below have been remediated in code while preserving existing public command shapes where practical.

## Findings

### F-01: Core/Tauri scan paths do not enforce the documented port-count limit

Severity: Medium

Status: Addressed. `netscli-core` now owns `MAX_PORTS_PER_SCAN`, `parse_ports_checked` rejects expanded input over 4,096 ports, and MCP references the shared core limit.

Evidence:
- `crates/netscli-core/src/common/ports.rs` expands user ranges in `parse_ports_checked`, sorts, and deduplicates, but does not cap the resulting count.
- `crates/netscli-core/src/ops/scan.rs` passes parsed ports directly into scan, inspect, and sweep operations.
- `apps/netscli-gui/src-tauri/src/commands/operations.rs` uses `parse_ports_checked` for GUI scan/inspect/sweep.
- `crates/netscli-mcp/src/server/schemas.rs` does cap MCP input at 4,096 ports, so enforcement is inconsistent.

Impact: CLI and GUI callers can accidentally request very large scans, such as `1-65535`, despite the repository safety policy saying max 4,096 ports per scan.

Recommendation: Move the 4,096-port cap into `netscli-core` so every interface shares it. Keep the MCP cap, but make it reference the shared constant or mirror the same error text. Add tests for `parse_ports_checked("1-4096")` and rejection of `1-4097`.

### F-02: GUI export command accepts renderer-supplied arbitrary file paths

Severity: Medium

Status: Addressed. The renderer no longer imports the Tauri dialog plugin or passes save paths. `export_text_file` lives in the Tauri backend file module, owns the native save dialog, and rejects renderer-supplied paths.

Original evidence:
- `apps/netscli-gui/src-tauri/src/commands/operations.rs` accepted `target_path` in `export_text_file`, created missing parent directories, and wrote `contents` to that path.
- The frontend got the path from Tauri's save dialog in `apps/netscli-gui/src/workspace/toolExecution.ts`, but a compromised renderer could call the command directly with any user-writable path.

Current evidence:
- `apps/netscli-gui/src-tauri/src/commands/files.rs` rejects non-empty `target_path` values and opens the native save dialog from the backend.
- GUI export calls pass `target_path: null`, so the renderer can choose file contents and a safe filename, but not an arbitrary filesystem path.

Impact: In a Tauri app, backend commands are a privilege boundary. If an XSS or renderer supply-chain issue were introduced later, this command would give the renderer arbitrary write capability under the user's privileges.

Recommendation: Do not accept raw arbitrary paths from the renderer. Prefer a backend-owned save flow, or restrict writes to explicitly allowed export roots. At minimum canonicalize, reject dangerous locations, reject directory creation outside approved roots, and keep the save-dialog path as a short-lived backend-issued token rather than a plain string.

### F-03: PCAP capture path and resource limits are too loose for agent-facing use

Severity: Medium

Status: Addressed. Core now rejects zero/oversized PCAP limits, applies a bounded default duration when no duration or packet limit is provided, requires `.pcap` capture output files, GUI captures use backend-owned automatic output or a backend-owned native save dialog, and MCP accepts only `.pcap` filenames rather than arbitrary paths.

Original evidence:
- `crates/netscli-core/src/ops/pcap.rs` accepted arbitrary `output_file` paths and converted `duration`/`max_packets` directly into `PcapConfig`.
- `crates/netscli-core/src/pcap.rs` captured until cancellation, duration, or max-packet limit. If neither duration nor max packets were provided, capture could run indefinitely.
- `crates/netscli-mcp/src/server/operations.rs` clamped duration to one hour, but allowed omitted or zero `maxPackets` to become unbounded.
- CLI exposes `--output`, `--duration`, and `--max-packets` directly in `apps/netscli-cli/src/cli_dispatch/pcap.rs`.

Current evidence:
- `crates/netscli-core/src/pcap/` splits capture execution, parsing, protocol summaries, shared types, and tests behind the existing facade.
- `apps/netscli-gui/src-tauri/src/commands/files.rs` owns GUI capture path selection and accepts only automatic output or native-save-dialog selection.
- Parsed packet summaries are returned for GUI/CLI consumption so capture results are inspectable without turning the GUI into an arbitrary filesystem writer.

Impact: Packet capture can collect sensitive local traffic and can write capture files wherever the caller can write. This is especially important for MCP because an AI agent can trigger the tool.

Recommendation: Add interface-specific policy at the boundary: GUI should use a user-visible save location, MCP should require bounded `maxPackets` and restrict output to a safe directory by default, and CLI should warn or require explicit confirmation when capture is unbounded. Consider a shared `PcapPolicy` in core so limits are explicit and testable.

### F-04: Tauri opener permission and release URLs should be allowlisted

Severity: Low

Status: Addressed. External links now go through a GitHub-only allowlist, release toast URLs are validated before display, and the Tauri opener permission is scoped to `https://github.com/fstubner/netscli`.

Original evidence:
- `apps/netscli-gui/src-tauri/capabilities/main.json` granted broad opener access.
- `apps/netscli-gui/src/components/shell/AboutDialog.tsx` opened fixed GitHub URLs directly.
- `apps/netscli-gui/src/components/shell/ToastHost.tsx` opened `toast.actionUrl`; release toasts get that URL from GitHub's latest-release API.

Impact: Current usage is limited to GitHub release/project links, but the granted opener capability is broader than the app's actual need.

Recommendation: Centralize external URL opening behind an allowlist that only permits expected `https://github.com/fstubner/netscli` URLs and keep the Tauri opener permission scoped.

### F-05: GUI history persists full result data in `localStorage`

Severity: Low

Status: Addressed. Settings now include a "Save History" privacy control. Turning it off clears persisted history and stops recording new entries.

Evidence:
- `apps/netscli-gui/src/tools/types.ts` defines `HistoryEntry.result`.
- `apps/netscli-gui/src/workspace/historyStorage.ts` stores history entries in `localStorage`.

Impact: Persisted history can include local IPs, MAC addresses, vendor names, hostnames, DNS targets, and scan results. That is useful for UX, but it is sensitive local-network inventory.

Recommendation: Add a settings option to disable persistent history, and consider storing only command metadata by default. Keep "Clear History" visible and add a privacy note in documentation.

### F-06: DNS public fallback is useful but privacy-sensitive

Severity: Low

Status: Addressed. Public DNS fallback can be disabled with `NETSCLI_DNS_FALLBACK=off`, obvious local/internal names skip public fallback, and README documents the behavior.

Evidence:
- `crates/netscli-core/src/dns/resolver.rs` creates a Cloudflare fallback resolver.
- `crates/netscli-core/src/dns/lookup.rs` uses that fallback after the system resolver returns an error.

Impact: If the system resolver refuses or errors on a name, NetsCLI may send the queried hostname to Cloudflare. For public names this is fine; for internal or VPN/split-DNS names it may surprise users.

Recommendation: Make public DNS fallback configurable, document it, and consider disabling fallback for obvious local/internal suffixes or when the system resolver returns policy-like refusal.

### F-07: CSP is reasonable, but `style-src 'unsafe-inline'` remains a hardening item

Severity: Low

Status: Addressed. No inline style usage was found in the GUI source, so `style-src 'unsafe-inline'` was removed from the Tauri CSP.

Original evidence:
- `apps/netscli-gui/src-tauri/tauri.conf.json` set `script-src 'self'`, but `style-src` included inline styles.

Impact: This is not an immediate issue without a script/HTML injection sink, but reducing inline style permissions improves defense in depth.

Recommendation: Keep `script-src` strict. Later, audit whether inline styles are still needed and remove `'unsafe-inline'` if practical.

## Positive Controls

- No `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, `new Function`, or `postMessage` sink was found in the GUI source paths reviewed.
- `window.open` fallback calls use `noopener,noreferrer`.
- Tauri does not grant a shell plugin permission in the main window capability file.
- Core subnet size is capped at `/16` in `crates/netscli-core/src/ops/validation.rs`.
- `Ops::new` clamps concurrency to `1..=1024`.
- MCP validates subnet size and uses the shared core 4,096-port cap.
- Scan enrichment reads are bounded and time-limited.
- PCAP support remains feature-gated at compile time.
- `cargo audit` and `npm audit --omit=dev` reported no current vulnerabilities.

## UX Progress State

The GUI now has an operation progress strip rendered above the results/content area when the active tab is busy:

- Component: `apps/netscli-gui/src/components/results/OperationProgress.tsx`
- Render site: `apps/netscli-gui/src/App.tsx`
- Styling: `apps/netscli-gui/src/styles/results.css`

This is a contextual thin loading bar before the table region. It is not yet a table-header-integrated progress state, and it does not yet show determinate progress counts for operations that can report them.

## Verification

Completed:
- `cargo audit` — clean.
- `npm audit --omit=dev` — clean.
- `cargo test -p netscli-core` — passed.
- `cargo test -p netscli-mcp` — passed.
- `cargo test -p netscli` — passed.
- `cargo check --manifest-path apps/netscli-gui/src-tauri/Cargo.toml` — passed.
- `cargo clippy --all-targets -- -D warnings` — passed.
- `cargo clippy --all-targets --features pcap -- -D warnings` — passed.
- `.\scripts\test-pcap.ps1` — passed.
- `cd apps/netscli-gui && npm run test:unit` — passed.
- `cd apps/netscli-gui && npm run build` — passed.
- `cd apps/netscli-gui && npm run test:tauri-render` — passed.
