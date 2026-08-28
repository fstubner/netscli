# Publishing netscli

Per-channel reference: what each distribution channel is, what publishes to
it, what it needs, and how to fix it when it breaks.

For the step-by-step *process* of cutting a release, see
[`RELEASE.md`](RELEASE.md). This document is the reference you consult when
one channel misbehaves.

## Channels at a glance

netscli publishes to **six** channels via **nine** automated jobs. Everything
except the crates.io publish is triggered by promoting a GitHub release to
public.

| Channel | Artifacts | Job in `publish.yml` | Deployed to |
| --- | --- | --- | --- |
| crates.io | `netscli-core`, `netscli-mcp`, `netscli` | `crates-io` | crates.io |
| GitHub Releases | 11 CLI assets + 5 GUI installers, each with `.sha256`/`.sig`/`.pem` | *(`release.yml`, not `publish.yml`)* | this repo's Releases |
| Homebrew | CLI formula + GUI cask | `homebrew`, `homebrew-cask` | `fstubner/homebrew-tap` |
| Scoop | CLI + GUI manifests | `scoop`, `scoop-gui` | `fstubner/scoop-bucket` |
| winget | `fstubner.netscli`, `fstubner.netscli.gui` | `winget`, `winget-gui` | `microsoft/winget-pkgs` (PR) |
| AUR | `netscli-bin`, `netscli-gui-bin` | `aur`, `aur-gui` | `aur.archlinux.org` |

Templates for the packaging manifests live under [`packaging/`](../packaging/)
for reference. The **deployed** copies live in the tap, bucket, AUR, and
winget-pkgs — the jobs re-stamp those on every release; the templates in this
repo are not what users install.

### What is NOT published

- **The desktop app is not on crates.io.** `netscli-gui` is a Tauri app,
  distributed only as platform installers.
- **No published artifact has packet capture.** Every release asset and
  installer is built without `--features pcap`, deliberately, so the default
  install has no libpcap/Npcap dependency and we do not redistribute Npcap.
  The `-pcap` CLI variants are the exception and are published as separate
  release assets. There is no packet-capture desktop installer at all.

## Crates.io

Three crates depend on each other, and crates.io requires dependencies to be
published first, so the order matters.

### Publish order

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
| `CHANGELOG.md` | the release heading (see below for its date and link) |

Missing the last three is what shipped a GUI installer stamped with the
wrong version at v0.2.4 and got the Winget submission rejected by a
moderator (see the 0.2.4 entry in `CHANGELOG.md`). The website reads its
version from `apps/netscli-gui/package.json`, so a miss there also
silently mislabels netscli.com.

### The changelog date and link go on with the tag, not with the bump

A version heading gets `## [0.4.0]` at bump time and nothing more. The
` — YYYY-MM-DD` and the `[0.4.0]: …/releases/tag/v0.4.0` reference are added
in the same change that pushes the tag.

Both are claims about the outside world, and the website reads them straight
out of this file. 0.3.1 was bumped and dated `2026-08-24` in the release
commit, then not tagged; netscli.com showed "v0.3.1 — 24 Aug 2026" for four
days, and the link reference pointed at a tag page that did not exist. The
version bump is a statement about this repository and can happen whenever;
the date and the link are statements about a release that exists.

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

## GitHub Releases

Platform installers, and the download links the install scripts resolve,
come from the GitHub release — not crates.io. `release.yml` fires on
`release: published`.

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
# Then: Releases → Draft a new release → pick the tag → notes → publish.
```

It builds and attaches, per asset, four files: the artifact, `.sha256`,
`.sig`, and `.pem`.

- **11 CLI assets** — linux x86_64/aarch64 (gnu, each with a `-pcap`
  variant), linux x86_64 musl (no `-pcap`), windows x86_64 (plus `-pcap`),
  macos x86_64/aarch64 (each plus `-pcap`).
- **5 GUI installers** from 4 matrix entries — the Linux entry emits both
  `.deb` and `.AppImage`; then two `.dmg` (aarch64, x86_64) and one `.msi`.

Signing is Sigstore keyless via `cosign sign-blob`, using the Actions OIDC
token — no key material is stored. Consumers verify with the command in
[`RELEASE.md`](RELEASE.md#sigstore-signature-verification). Note that
**nothing downstream verifies these signatures automatically**; the package
managers rely on their own hash checks instead.

**Windows pcap builds** link against the Npcap SDK, which `release.yml`
downloads and verifies against a pinned SHA256. Bumping the SDK version
means re-pinning that digest.

## Site previews (Cloudflare Pages)

**Production is not involved.** netscli.com is served from GitHub Pages via
`pages.yml`, which stays manual-only. `site-preview.yml` deploys to a
separate Cloudflare Pages project and always passes an explicit
`--branch=pr-<N>`, which Cloudflare treats as a preview deployment. There is
no code path in that workflow that produces a production deploy.

### Enabling it

The workflow runs today and reports "not configured" until two repository
secrets exist. Nothing fails in the meantime.

1. **Create the Pages project** (one-off, direct-upload mode — do *not*
   connect it to Git, or Cloudflare will start building on its own and you
   will have two things deploying the site):

   ```bash
   npx wrangler@4 pages project create netscli-site-preview \
     --production-branch=unused-production-branch
   ```

   The production branch is deliberately a name no PR will ever use, so the
   project has no reachable production deployment.

2. **Add two repository secrets** under Settings → Secrets and variables →
   Actions:

   | Secret | Where from |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token. Template "Edit Cloudflare Workers", or a custom token with **Account → Cloudflare Pages → Edit**. Scope it to the one account. |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID in the right-hand pane |

3. Open a PR touching `site/**`. The workflow comments the preview URL and
   updates that same comment on later pushes.

### What a preview build changes

Preview builds set `NETSCLI_PREVIEW=1`, which does two things that matter:

- **`robots: noindex, nofollow` on every page.** Emitted by
  `src/layouts/Page.astro` for the landing/changelog/404 pages *and* by the
  `head` entry in `astro.config.mjs` for the Starlight docs pages — those use
  Starlight's own layout, so the first mechanism alone leaves 11 of 14 pages
  crawlable.
- **The Cloudflare Web Analytics beacon is suppressed.** A preview is still a
  production Astro build (`import.meta.env.PROD` is true), so without this
  every PR deploy would report into netscli.com's real analytics property.

The workflow **verifies both before deploying** and fails the job rather than
publishing an indexable or analytics-reporting preview.

Neither affects a normal build: production still emits the beacon, and only
the 404 carries `noindex`.

## Homebrew

Two artifacts in one tap, `fstubner/homebrew-tap`:

| Artifact | File | Job | Install |
| --- | --- | --- | --- |
| CLI | `Formula/netscli.rb` | `homebrew` | `brew install fstubner/tap/netscli` |
| Desktop | `Casks/netscli-gui.rb` | `homebrew-cask` | `brew install --cask fstubner/tap/netscli-gui` |

**The Cask's token is `netscli-gui`, not `netscli`.** It used to be
`netscli`, sharing a token with the CLI Formula in the same tap, which made
a bare `brew install netscli` ambiguous and left Homebrew as the only
registry that did not distinguish the two artifacts by name — scoop has
`netscli`/`netscli-gui`, AUR `netscli-bin`/`netscli-gui-bin`, winget
`fstubner.netscli`/`fstubner.netscli.gui`.

`publish-homebrew-cask.sh` deletes a leftover `Casks/netscli.rb` the first
time it runs against a tap that still has one. Prefer the fully-qualified
`fstubner/tap/...` form in documentation so it works without a separate
`brew tap` step.

`publish-homebrew.sh` sed-patches the version and awk-patches each `sha256`
that follows a matching url line. `publish-homebrew-cask.sh` regenerates the
Cask wholesale from a quoted heredoc, because the Cask block puts `sha256`
*before* `url` and a single-pass awk would need a backwards lookup.

Needs `HOMEBREW_TAP_TOKEN`.

## Scoop

Two manifests in `fstubner/scoop-bucket`, both patched with `jq`:

| Artifact | File | Job | Install |
| --- | --- | --- | --- |
| CLI | `bucket/netscli.json` | `scoop` | `scoop install netscli` |
| Desktop | `bucket/netscli-gui.json` | `scoop-gui` | `scoop install netscli-gui` |

Users add the bucket once with
`scoop bucket add fstubner https://github.com/fstubner/scoop-bucket`.

Needs `SCOOP_BUCKET_TOKEN`.

## winget

Two package identifiers submitted to `microsoft/winget-pkgs` by
`vedantmgoyal9/winget-releaser`, which forks the repo under your account and
opens a PR.

| Identifier | Job | Install |
| --- | --- | --- |
| `fstubner.netscli` | `winget` | `winget install fstubner.netscli` |
| `fstubner.netscli.gui` | `winget-gui` | `winget install fstubner.netscli.gui` |

**A moderator has to merge the PR** — usually hours to days. This is the one
channel that is not fully automated, and the CLA must be signed once per
account.

Both jobs poll for the relevant `.sha256` sidecar for up to 15 minutes before
invoking the action, because `release.yml` and `publish.yml` both fire on
`release: published` and race each other. Without the poll the action sees no
matching asset and fails with an empty `--urls`.

winget is the **recommended Windows install path** because it verifies the
installer against the SHA256 in the manifest. Direct MSI/NSIS downloads are
unsigned and show SmartScreen warnings — see
[`RELEASE.md`](RELEASE.md#windows-trust-and-signing-policy). Do not describe
winget as a substitute for Authenticode signing.

The `packaging/winget/<pkg>/<version>/` directories are **reference copies**
of submitted manifests, one directory per version. Do not edit an existing
version's directory to hold a different version's content — winget-pkgs keys
on the directory name, and a mismatch files a conflicting duplicate.

Needs `WINGET_TOKEN` (classic PAT, `public_repo`).

### PackageVersion carries no `v`, and five published versions do

The catalog currently holds, for `fstubner.netscli`:

```
0.2.0  v0.2.2  v0.2.3  v0.2.4  v0.2.5  v0.2.6
```

Only `0.2.0` is right. It was submitted by hand; the other five came from the
`winget` job, which passed the git tag straight through as `PackageVersion`
before that was fixed. `fstubner.netscli.gui` is unaffected — its single
`0.2.6` was also hand-submitted.

**This does not break upgrades.** winget normalises a leading `v` when
comparing, checked against the client rather than assumed:

```
> winget list --id fstubner.netscli
netscli  fstubner.netscli  0.2.0  v0.2.6  winget      # offers the upgrade

> winget show fstubner.netscli --version 0.2.6        # resolves v0.2.6
> winget show fstubner.netscli --version 0.2.9        # finds nothing
```

What it does do is display a version the project never issued, and put the
two packages side by side inconsistently in `winget search`:

```
netscli          fstubner.netscli      v0.2.6
NetsCLI Desktop  fstubner.netscli.gui  0.2.6
```

The next correctly-versioned release fixes the display, since `winget search`
and `winget install` use the latest version. The old directories stay in the
catalog unless someone removes them.

**Removing them is optional and not automated.** It means a PR to
`microsoft/winget-pkgs` deleting `manifests/f/fstubner/netscli/v0.2.*/`, which
breaks anyone pinned to one of those versions with
`winget install --version`. Weigh that against a tidy version list; doing
nothing is a defensible answer.

Do **not** set the action's `max-versions-to-keep` to prune them. That deletes
versions from the public catalog as a side effect of an ordinary release,
which is not something a release should do quietly.

The `Resolve PackageVersion` step now asserts `MAJOR.MINOR.PATCH` and fails
the job otherwise. Stripping the `v` was already enough to produce the right
answer; the assertion exists because winget-pkgs accepted all five bad ones
without complaint, so nothing downstream will catch a recurrence.

## AUR

Two packages pushed over SSH by `KSXGitHub/github-actions-deploy-aur`, which
regenerates `.SRCINFO` server-side.

| Package | Job | Install |
| --- | --- | --- |
| `netscli-bin` | `aur` | `yay -S netscli-bin` |
| `netscli-gui-bin` | `aur-gui` | `yay -S netscli-gui-bin` |

Each job computes the asset SHA256s, renders a bumped PKGBUILD with `sed`,
and pushes. The render happens **inside `$GITHUB_WORKSPACE`**, not `/tmp` —
the deploy action runs in a container that mounts the workspace only, and a
`/tmp` path produces a confusing `bash: --command: invalid option` error.

AUR has **no review step**. A bad push is live immediately.

Needs `AUR_SSH_PRIVATE_KEY`.

## When a channel fails

Every job is independent and re-runnable. `publish.yml` accepts a
`workflow_dispatch` tag input, so you can re-run a single channel without
rebuilding binaries or touching the others:

```bash
gh workflow run publish.yml -f tag=vX.Y.Z
```

The publish scripts are idempotent — re-running a channel that already
succeeded commits nothing and exits cleanly, rather than failing on "nothing
to commit".

Failure modes worth knowing:

| Symptom | Cause |
| --- | --- |
| `refusing to publish malformed tag` | The tag input is not `vMAJOR.MINOR.PATCH[-prerelease]`. Deliberate — the tag reaches `sed` replacements and commit messages. |
| `checksum mismatch for <asset>` | The `.sha256` sidecar disagrees with the actual bytes. The scripts download and re-hash rather than trusting the sidecar; investigate before overriding. |
| `<asset>.sha256 is not a 64-char hex digest` | Sidecar truncated or missing. Previously this silently produced a manifest with blank hashes. |
| `never became available` after 15 min | `release.yml` did not attach the asset. Check that job first; publishing cannot proceed without it. |
| winget job fails with empty `--urls` | Asset poll passed but the action ran too early, or the package has never been accepted into winget-pkgs. |
| crates.io "no matching package named …" | An earlier crate in the order has not indexed yet. Wait and re-run; the job sleeps 90s between publishes. |

Because crates.io publishes are **permanent** — you can yank but not delete,
and a yanked version keeps its number — a failed crates.io publish means
bumping the patch version, not retrying the same one.
