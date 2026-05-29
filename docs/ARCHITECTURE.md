# NetsCLI Architecture And Ownership

NetsCLI has one behavioral core and four user-facing interfaces. New network behavior belongs in `netscli-core` first, then each interface should call that shared operation instead of reimplementing probes or parsing locally.

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
machine-local SDK path into Cargo config.

## Module Size Guidance

Keep runtime and automation source files under roughly 300 lines when practical. `scripts/check-file-size.mjs` enforces this for Rust crates, CLI/TUI code, GUI frontend code, Tauri backend code, and GUI render automation. Static marketing-site content, generated assets, lockfiles, and vendored data are outside this guard.

When adding behavior, prefer a new owner module over growing a facade:

- TUI event-loop behavior belongs under `apps/netscli-cli/src/tui/runtime/`.
- TUI render helpers belong under `apps/netscli-cli/src/tui/state/render/`.
- GUI shell, result, workspace, and presentation logic should stay in their current component/hook/helper folders.
- GUI render automation should add focused scenario/helper modules under `apps/netscli-gui/e2e/tauri-render/scenarios/`.
