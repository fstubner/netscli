# Contributing

Issues and pull requests are welcome.

## Prerequisites

You need Rust at the version pinned in `rust-toolchain.toml`. The desktop app
also needs Node.js 22 or newer. `.nvmrc` pins 22, which is what CI runs.

On Linux, `cargo test --all` and `cargo clippy --all-targets` compile the
desktop app's Tauri crate as well, and it will not link without the GTK and
WebKit development packages. On Debian or Ubuntu, CI installs these:

```bash
sudo apt-get install -y \
  libpcap-dev pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

`libpcap-dev` is only for packet capture builds. Other distributions have
equivalents, listed in
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

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

On Windows that also needs the Npcap SDK and the Npcap runtime.
`scripts/test-pcap.ps1` sets `LIB`, `INCLUDE` and the runtime `PATH` for you,
and `scripts/dev-gui-pcap.ps1` does the same for the desktop app. Both look
for the extracted SDK in `NPCAP_SDK`, or in `%LOCALAPPDATA%\netscli\npcap-sdk`
when that is not set, and stop with an error if `Lib\x64\wpcap.lib` is not
there. Requirements are covered in the
[packet capture docs](https://netscli.com/docs/packet-capture/).

### Cross-compiling

```bash
rustup target add x86_64-unknown-linux-musl
cargo build -p netscli --target x86_64-unknown-linux-musl --release
```

### Checking the Linux code from Windows

`netscli-core` has Linux-only code, such as the ARP table and raw ICMP, that
a Windows build never compiles. `./scripts/check-linux.sh` runs clippy and
the tests for the three Rust crates in Docker, with every feature on. It
skips the desktop app and is not the macOS path, so CI is still the check
that counts.

## Before opening a PR

CI runs these checks, so run them before you push. If this list and
`.github/workflows/ci.yml` ever disagree, the workflow is right.

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features pcap -- -D warnings
cargo test --all
```

If you changed the desktop app, also run these in `apps/netscli-gui`:

```bash
npm run lint
npm run test:unit
npm run build
```

And these from the repository root. They hold source files to about 300 lines,
check the design tokens, and check that the app's links into the docs site
still resolve:

```bash
node scripts/check-file-size.mjs
node scripts/design-tokens.mjs
node scripts/check-app-doc-links.mjs
```

Two more things are easy to miss. CI checks that the TypeScript types in
`apps/netscli-gui/src/types/generated` match the Rust structs they come from,
so after changing a struct the desktop app mirrors, regenerate them with the
command in the `TypeScript bindings match the Rust types` step of `ci.yml`.
And CI only compiles the Windows packet capture tests, so if you changed
packet capture code, run `./scripts/test-pcap.ps1` on a Windows machine with
Npcap installed.

Changes under `site/` run their own checks, listed in
`.github/workflows/site.yml`, starting with `npm run build` and `npm run check`
in `site/`.

Add tests for new behaviour, and update the docs under `site/src/content/docs/`
when you change something a user would notice. The narrower per-crate commands
are under Contribution Gates in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
