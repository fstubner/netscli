# Contributing

Issues and pull requests are welcome.

## Prerequisites

Rust 1.96.0, pinned in `rust-toolchain.toml`. The desktop app also needs
Node.js 18+.

## Building

```bash
cargo build -p netscli              # debug
cargo build --release -p netscli    # CLI, TUI and MCP server
cargo test --all
```

The desktop app runs through Tauri:

```bash
cd apps/netscli-gui
npm install
npm run tauri:dev
```

Launch it that way rather than running the built binary directly. A debug
Tauri build expects the Vite dev server on `localhost:1420` and shows an empty
window without it. To produce installers instead, use `npm run tauri build`.

### Packet capture builds

Packet capture is feature-gated so the default binary has no non-Rust runtime
dependencies. Build it with `--features pcap`.

On Windows that also needs the Npcap SDK. `scripts/test-pcap.ps1` sets `LIB`,
`INCLUDE` and the runtime `PATH` for you, and `scripts/dev-gui-pcap.ps1` does
the same for the desktop app. Requirements are covered in the
[packet capture docs](https://netscli.com/docs/packet-capture/).

### Cross-compiling

```bash
rustup target add x86_64-unknown-linux-musl
cargo build -p netscli --target x86_64-unknown-linux-musl --release
```

## Before opening a PR

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test --all
```

Add tests for new behaviour, and update the docs under `site/src/content/docs/`
when you change something a user would notice.

## Repository layout

```
crates/netscli-core/   # scanning logic, shared by everything
crates/netscli-mcp/    # MCP server
apps/netscli-cli/      # CLI and terminal UI
apps/netscli-gui/      # Tauri desktop app
packaging/             # Homebrew, Scoop, AUR and winget manifests
scripts/               # build and release helpers
site/                  # netscli.com, the landing page and docs
```

Crate boundaries, dependency direction and the rules about what may live where
are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Updating the MAC vendor database

```bash
cd scripts
cargo run --bin generate-oui
```

This pulls from IEEE and Wireshark and regenerates
`crates/netscli-core/data/oui.min.json.gz`, which ships inside the
`netscli-core` crate.
