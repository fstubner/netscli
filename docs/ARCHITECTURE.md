# NetsCLI Architecture And Ownership

NetsCLI has one behavioral core and four user-facing interfaces. New network behavior belongs in `netscli-core` first, then each interface should call that shared operation instead of reimplementing probes or parsing locally.

## Parts

Five deployables over one behavioural core. Only the core is shared; nothing
below it imports anything above it.

| Part | Path | Ships as | Talks to |
| --- | --- | --- | --- |
| Core library | `crates/netscli-core` | crates.io (`netscli-core`) | the OS and the network |
| MCP server | `crates/netscli-mcp` | crates.io (`netscli-mcp`), exposed by `netscli serve` | an MCP client over stdio |
| CLI and TUI | `apps/netscli-cli` | crates.io (`netscli`), installers, package managers | a terminal |
| Desktop app | `apps/netscli-gui` | MSI / DMG / AppImage / deb | its own WebView frontend |
| Website and docs | `site` | static hosting | browsers |

The desktop app is itself two pieces: a Rust binary and a React frontend it
serves into a WebView. They are one deployable but not one program, which is
why the boundary between them is listed below.

## Boundaries

Four places where something crosses from one part to another. Everything
else is a Rust function call inside one process, which is not a boundary and
should not be treated as one.

| Boundary | Mechanism | What crosses |
| --- | --- | --- |
| MCP client → server | JSON-RPC over stdio | tool calls with arguments chosen by a model |
| WebView → desktop backend | Tauri IPC commands | form values a user typed |
| Any interface → core | in-process Rust calls | typed arguments, already validated |
| Core → network and OS | sockets, `arp`, IP Helper, pcap | probes out, and **untrusted bytes back** |

The last row is the one people forget. A banner, a PTR record and a vendor
string are all written by whoever runs the other machine.

## Trust

Two boundaries carry real trust decisions; the rest are conveniences.

**The MCP surface is the trust boundary.** Its arguments come from a model,
which may be repeating something it read on a scanned host. Two guards, both
in `crates/netscli-mcp/src/server/`:

- `targets.rs` refuses anything outside local scope unless explicitly
  permitted (`is_local_scope`, `ensure_ip_allowed`, `public_targets_allowed`),
  so a prompt-injected model cannot point the scanner at strangers.
- `limits.rs` caps what a scanned host can put into a model's context —
  banners truncated to `MAX_BANNER_CHARS` (256), whole results to
  `MAX_RESULT_BYTES` (1 MiB), applied to the fields that carry remote text
  (`REMOTE_TEXT_KEYS`: `banner`, `hex_preview`, `info`).

Neither may be relaxed to make something faster or more capable. A tool that
finds unauthenticated services is exactly the one that must not be steerable
by the thing it reports to.

**Remote text is data, never markup or control.** Trace output is asserted
free of terminal control sequences (`tests/test_trace.rs`), because an ESC
reaching a terminal can repaint the screen and forge the lines above it. The
GUI renders remote strings as text, never as HTML.

**Privilege is a boundary the user owns.** Raw ICMP and clearing the ARP
table need administrator rights. Where a capability is unavailable the
product says so and stops; it never silently substitutes a weaker method and
reports the result as though the stronger one had run. `arp -d *` exiting 0
while printing "requires elevation" is the reason that rule is written down.

**The website is outside all of this.** It is static, ships no user data, and
holds no credentials.

## Ownership Map

| Area | Primary Path | Ownership |
| --- | --- | --- |
| Core operations facade | `crates/netscli-core/src/ops.rs`, `ops/` | Stable high-level methods used by CLI, TUI, GUI, and MCP |
| Port scanning | `crates/netscli-core/src/scan.rs`, `scan/` | TCP connect classification and open-port enrichment |
| DNS | `crates/netscli-core/src/dns.rs`, `dns/` | Record parsing, resolver construction, lookup, reverse lookup |
| ARP/interfaces | `crates/netscli-core/src/arp.rs`, `arp/` | Shared ARP/interface types plus platform implementations |
| Persistence | `crates/netscli-core/src/db.rs`, `db/` | SQLite bootstrap, migrations, host and scan-history repositories |
| CLI dispatch | `apps/netscli-cli/src/cli_dispatch.rs`, `cli_dispatch/` | Clap subcommand execution and structured/text output selection |
| CLI text formatting | `apps/netscli-cli/src/cli_formatter.rs`, `cli_formatter/` | Human-readable command output only |
| TUI behavior | `apps/netscli-cli/src/tui/` | Interactive command routing, state, widgets, and render paths |
| Tauri backend | `apps/netscli-gui/src-tauri/src/commands/` | Thin command wrappers around `netscli-core::Ops` |
| GUI frontend | `apps/netscli-gui/src/` | React app frame, workspace state, presentation helpers, render automation |
| MCP server | `crates/netscli-mcp/src/server.rs`, `server/` | JSON-RPC protocol, schemas, tool dispatch, operation adapters |

## Compatibility Rules

- Preserve public Rust names and method signatures unless there is an explicit API change plan.
- Keep CLI syntax, MCP tool schemas, Tauri command payloads, GUI data shapes, and SQLite schema stable during refactors.
- Prefer facades and re-exports when splitting modules so existing imports continue to compile.
- Do not add GUI-only, TUI-only, CLI-only, or MCP-only network logic. Interfaces should call `netscli-core` or add a missing operation to `Ops`.
- Do not weaken safety limits in `ops/` or MCP validation without a separate review.

## Contribution Gates

Run the narrowest relevant checks while iterating, then the full gate before shipping cross-cutting changes:

```bash
cargo fmt --check
cargo test -p netscli-core
cargo test -p netscli-mcp
cargo test -p netscli
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features pcap -- -D warnings
./scripts/test-pcap.ps1
cd apps/netscli-gui && npm run test:unit && npm run build
cd apps/netscli-gui && npm run test:maintainability
cd apps/netscli-gui && npm run test:tauri-render
```

For final release-level confidence, run:

```bash
cargo test --all --no-fail-fast
cargo audit
npm outdated --prefix apps/netscli-gui
cargo update --dry-run
git diff --check
```

On Windows, `--features pcap` source builds require the Npcap runtime plus the
Npcap SDK import library. Put the SDK architecture directory containing
`wpcap.lib` on `LIB` for the build process, and put
`C:\Windows\System32\Npcap` on `PATH` for runtime checks. Do not commit a
machine-local SDK path into Cargo config. `scripts/test-pcap.ps1` sets the
expected Windows environment for the PCAP test target from `NPCAP_SDK` or
`C:\tmp\netscli-npcap-sdk`.

## Module Size Guidance

Keep runtime and automation source files under roughly 300 lines when practical. `scripts/check-file-size.mjs` enforces this for Rust crates, CLI/TUI code, GUI frontend code, Tauri backend code, and GUI render automation. Static marketing-site content, generated assets, lockfiles, and vendored data are outside this guard.

The guard has a small explicit transition-exception list for files that are
already over the target after the GUI professionalization work. Each exception
has a capped line count and a reason. Do not add new exceptions casually: split
the file instead, or lower/remove an existing exception when follow-up refactors
reduce it.

When adding behavior, prefer a new owner module over growing a facade:

- TUI event-loop behavior belongs under `apps/netscli-cli/src/tui/runtime/`.
- TUI render helpers belong under `apps/netscli-cli/src/tui/state/render/`.
- GUI shell, result, workspace, and presentation logic should stay in their current component/hook/helper folders.
- GUI render automation should add focused scenario/helper modules under `apps/netscli-gui/e2e/tauri-render/scenarios/`.
