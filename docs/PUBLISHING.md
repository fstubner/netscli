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

**The crates do NOT inherit a version from the workspace.** Root
`Cargo.toml`'s `[workspace.package]` block has no `version` key — each
crate hardcodes its own, and the desktop app carries three more copies
outside Cargo entirely. Seven files have to move together:

| File | What it sets |
| --- | --- |
| `crates/netscli-core/Cargo.toml` | core crate version |
| `crates/netscli-mcp/Cargo.toml` | MCP crate version **+ its `netscli-core` dep spec** |
| `apps/netscli-cli/Cargo.toml` | CLI crate version **+ its `netscli-core`/`netscli-mcp` dep specs** |
| `apps/netscli-gui/src-tauri/Cargo.toml` | Tauri backend crate version |
| `apps/netscli-gui/src-tauri/tauri.conf.json` | installer/bundle version |
| `apps/netscli-gui/package.json` | version shown in the GUI About dialog and on the website |
| `CHANGELOG.md` | the release heading and its link reference |

Missing the last three is what shipped a GUI installer stamped with the
wrong version at v0.2.4 and got the Winget submission rejected by a
moderator (see the 0.2.4 entry in `CHANGELOG.md`). The website reads its
version from `apps/netscli-gui/package.json`, so a miss there also
silently mislabels netscli.com.

To release 0.4.0 from 0.3.0:

```bash
OLD=0.3.0
NEW=0.4.0

# Crate versions and the inter-workspace dep specs.
sed -i "s/\"${OLD}\"/\"${NEW}\"/g" \
    crates/netscli-core/Cargo.toml \
    crates/netscli-mcp/Cargo.toml \
    apps/netscli-cli/Cargo.toml \
    apps/netscli-gui/src-tauri/Cargo.toml

# The GUI's two non-Cargo version files.
sed -i "s/\"version\": \"${OLD}\"/\"version\": \"${NEW}\"/" \
    apps/netscli-gui/package.json \
    apps/netscli-gui/src-tauri/tauri.conf.json

# Refresh the lockfile so the bumped versions are recorded.
cargo update -w
```

Then verify every surface agrees before tagging — this should print
`${NEW}` and nothing else:

```bash
{
  grep -h '^version' crates/*/Cargo.toml apps/netscli-cli/Cargo.toml \
      apps/netscli-gui/src-tauri/Cargo.toml
  grep -h '"version"' apps/netscli-gui/package.json \
      apps/netscli-gui/src-tauri/tauri.conf.json
} | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u
```

Finally, move the `## [Unreleased]` content in `CHANGELOG.md` under a
`## [X.Y.Z] — YYYY-MM-DD` heading and add the matching link reference at
the bottom of the file.

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
