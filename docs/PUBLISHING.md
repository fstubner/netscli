# Publishing netscli

This is a workspace with three publishable crates that depend on each other.
Crates.io requires dependencies to be published before anything that depends
on them, so the order matters.

## Publish order

1. `netscli-core` (the library — depends on nothing in-workspace)
2. `netscli-mcp` (depends on `netscli-core`)
3. `netscli` (depends on `netscli-core` and `netscli-mcp`)

The `netscli-gui` crate is a Tauri app, not intended for crates.io — it's
distributed as platform installers via the GitHub release workflow.

## One-time setup

```bash
# If you don't already have one, create an account at https://crates.io
# and generate an API token in your Account Settings.
cargo login <your-crates.io-token>
```

## Pre-publish checklist

```bash
# Everything green, nothing uncommitted.
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features pcap -- -D warnings
cargo test --all --no-fail-fast
cargo audit
cd apps/netscli-gui && npm run test:unit && npm run test:maintainability && npm run build
git status                                    # should be clean

# Windows note: `--features pcap` needs the Npcap SDK import library.
# Set LIB to the SDK directory containing wpcap.lib before running the
# PCAP clippy/build gates, for example C:\path\to\npcap-sdk\Lib\x64.

# Dry-run each crate — this builds a tarball without uploading and
# validates the manifest (no missing metadata, no path-only deps, etc).
cargo package -p netscli-core
cargo package -p netscli-mcp
cargo package -p netscli
```

Read the tarball contents (`target/package/*.crate`) if you want to be
sure the right files are being shipped. `cargo package --list -p <crate>`
prints the file list without building.

## Publish

```bash
# Do these ONE AT A TIME. Each publish blocks until crates.io has indexed
# the new version (usually a few seconds) before the next one can resolve it.

cargo publish -p netscli-core
# wait a bit, then:
cargo publish -p netscli-mcp
# wait again:
cargo publish -p netscli
```

If something goes wrong after step 1 or 2, remember: **crates.io publishes
are permanent**. You can't delete a published version, only `yank` it,
and a yanked version still occupies the version number. Bump the patch
(0.1.1, 0.1.2, …) instead of re-publishing the same number.

## Version bumps

All three crates share a version (inherited from the workspace). To
release 0.2.0:

```bash
# Update all three in one go.
sed -i 's/^version = "0\.1\.0"$/version = "0.2.0"/' \
    Cargo.toml apps/netscli-cli/Cargo.toml \
    crates/netscli-core/Cargo.toml crates/netscli-mcp/Cargo.toml

# Also bump the `version = "0.1.0"` spec on the inter-workspace deps:
sed -i 's/version = "0\.1\.0"/version = "0.2.0"/g' \
    apps/netscli-cli/Cargo.toml crates/netscli-mcp/Cargo.toml

# Verify consistency:
grep -rn '^version\|version = "' Cargo.toml apps/ crates/ | grep -v target
```

## GitHub release

Platform installers (and the download links in the install scripts) come
from the GitHub release, not crates.io. The `release.yml` workflow fires
when you publish a release on GitHub:

```bash
# Tag the commit
git tag v0.2.0
git push origin v0.2.0

# Then on GitHub: Releases → Draft a new release → pick the tag →
# fill in notes → publish. The workflow builds binaries for every
# platform in the matrix and attaches them as release assets.
```
