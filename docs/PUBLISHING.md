# Publishing netscli

The per-channel reference. It says what each distribution channel is, what
publishes to it, what it needs, and how to fix it when it breaks.

For the step-by-step *process* of cutting a release, see
[`RELEASE.md`](RELEASE.md). This document is the reference you consult when
one channel misbehaves.

## Channels at a glance

`publish-release.yml` builds the GitHub release with `release.yml` while it is
still a draft, checks it, makes it public, and then starts `publish.yml`,
which publishes to every other channel in 13 jobs, and `pages.yml`, which
redeploys netscli.com.

| Channel | Artifacts | Built or published by | Deployed to |
| --- | --- | --- | --- |
| GitHub Releases | 11 CLI binaries and 7 desktop files, each with `.sha256`, `.sig` and `.pem`, plus `latest.json` | `release.yml`, called by `publish-release.yml` | this repo's Releases |
| crates.io | `netscli-core`, `netscli-mcp`, `netscli` | `crates-io` | crates.io |
| npm | the `netscli` launcher and 5 platform packages | `npm` | npmjs.com |
| MCP Registry | `io.github.fstubner/netscli`, which points at the npm package | `mcp-registry` | registry.modelcontextprotocol.io |
| MCP bundles | 5 `.mcpb` files, each with `.sha256`, `.sig` and `.pem` | `mcpb`, `mcpb-sign` | this repo's Releases |
| Homebrew | CLI formula and GUI cask | `homebrew`, `homebrew-cask` | `fstubner/homebrew-tap` |
| Scoop | CLI and GUI manifests | `scoop`, `scoop-gui` | `fstubner/scoop-bucket` |
| winget | `fstubner.netscli`, `fstubner.netscli.gui` | `winget`, `winget-gui` | `microsoft/winget-pkgs` (PR) |
| AUR | `netscli-bin`, `netscli-gui-bin` | `aur`, `aur-gui` | aur.archlinux.org |
| netscli.com | the site, `/install.sh`, `/install.ps1`, the Store's MSI copies | `pages.yml` | GitHub Pages |
| Microsoft Store | the desktop MSI | `msstore.yml`, run by hand | Partner Center, see [`MICROSOFT-STORE.md`](MICROSOFT-STORE.md) |

The jobs without a workflow name in the third column are in `publish.yml`.

Templates for the packaging manifests live under [`packaging/`](../packaging/)
for reference. The **deployed** copies live in the tap, bucket, AUR, and
winget-pkgs. The jobs regenerate those on every release, and the templates in
this repo are not what users install.

### What is NOT published

- **The desktop app is not on crates.io.** `netscli-gui` is a Tauri app,
  distributed only as platform installers.
- **Only the `-pcap` CLI release assets have packet capture.** Every other
  release asset, every installer and every package-manager build is built
  without `--features pcap`, so the default install has no libpcap or Npcap
  dependency and nothing redistributes Npcap. There is no packet-capture
  desktop installer at all.

## crates.io

Three crates depend on each other, so crates.io has to receive them in order.
`netscli-core` depends on nothing in the workspace, `netscli-mcp` depends on
`netscli-core`, and `netscli` depends on both.

The `crates-io` job publishes them from the tag, in one command that handles
the order itself. It first asks crates.io which of the three already have the
version and leaves those out, so a re-run after a partial upload finishes the
rest instead of failing on the first. Then:

1. `cargo publish --dry-run` packages each crate and builds the packaged copy,
   with no token in the step. This is the step that runs every dependency's
   build scripts.
2. `cargo publish --no-verify` uploads them in dependency order and waits for
   each to reach the index. The token is in `CARGO_REGISTRY_TOKEN`, and the
   step compiles nothing.

`ci.yml`'s `publish-dry-run` job runs the same dry run on every push to `main`
that touches code, so a packaging problem usually shows up long before a
release.

**crates.io publishes are permanent.** You can yank a version but not delete
it, and a yanked version keeps its number. A crate that went up broken means
bumping the patch version, not retrying the same one.

Publish by hand only if the job cannot, and only after the release is public:

```bash
cargo publish -p netscli-core -p netscli-mcp -p netscli
```

crates.io also supports trusted publishing from GitHub Actions, which would
remove `CARGO_REGISTRY_TOKEN` altogether. It needs a trusted publisher set up
on each crate's settings page first, and then the job switches to
`rust-lang/crates-io-auth-action`.

## Version bumps

**The crates do NOT inherit a version from the workspace.** Root `Cargo.toml`'s
`[workspace.package]` block has no `version` key. Each crate hardcodes its
own, and the desktop app carries two more copies outside Cargo. Seven files
have to move together:

| File | What it sets |
| --- | --- |
| `crates/netscli-core/Cargo.toml` | core crate version |
| `crates/netscli-mcp/Cargo.toml` | MCP crate version **and its `netscli-core` dependency** |
| `apps/netscli-cli/Cargo.toml` | CLI crate version **and its `netscli-core`/`netscli-mcp` dependencies** |
| `apps/netscli-gui/src-tauri/Cargo.toml` | Tauri backend crate version |
| `apps/netscli-gui/src-tauri/tauri.conf.json` | installer/bundle version |
| `apps/netscli-gui/package.json` | version shown in the GUI About dialog |
| `CHANGELOG.md` | the release heading (see below for its date and link) |

`apps/netscli-gui/package-lock.json` repeats the app's own version, and
`Cargo.lock` the crates', so both change too.

Six more, under `packaging/`, carry a version that nothing reads. Every
publish job rewrites it from the tag before the manifest reaches a registry.
They still have to move, because the version in a template is what a human
reviewing that template believes:

| File | What it sets |
| --- | --- |
| `packaging/aur/PKGBUILD` | `pkgver` |
| `packaging/aur/netscli-gui-bin/PKGBUILD` | `pkgver` |
| `packaging/homebrew/netscli.rb` | `version` |
| `packaging/homebrew/Casks/netscli-gui.rb` | `version` |
| `packaging/scoop/netscli.json` | `version` **and the asset URL** |
| `packaging/scoop/netscli-gui.json` | `version` **and the asset URL** |

All six sat at `0.3.0`, a version that was tagged, never published, and
whose tag was then deleted, until the 0.3.1 release. That is the same failure
the `@@…@@` digest placeholders in those files exist to prevent, one field
over. A plausible-looking value describes nothing.

Missing the GUI's three, rows four to six of the first table, is what shipped
a GUI installer stamped with the wrong version at v0.2.4 and got the winget
submission rejected by a moderator (see the 0.2.4 entry in `CHANGELOG.md`).

### The changelog date and link go on after the tag, not with the bump

A version heading gets `## [0.4.0]` at bump time and nothing more. The
` - YYYY-MM-DD` and the `[0.4.0]: …/releases/tag/v0.4.0` reference are a
separate commit, made once the tag is pushed. See
[Dating the release](#dating-the-release) for the sequence and for why they
cannot go in earlier.

0.3.1 was bumped and dated `2026-08-24` in the release commit, then not
tagged. netscli.com showed "v0.3.1, 24 Aug 2026" for four days, and the link
reference pointed at a tag page that did not exist. A date is still not a
release, though. The tag is pushed before the release goes public, so the
date is the day you mean to publish, and it moves if the release slips.
netscli.com does not take a dated heading as published. When `pages.yml`
deploys, it asks GitHub which releases are published, names the newest one
as the current version, and labels any other changelog entry "Not yet
released".

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

# package-lock.json records the app's own version twice, at the top and
# under packages[""]. Only its first lines, so a dependency that happens to
# share the version number is not touched.
sed -i "1,10 s/\"version\": \"${OLD}\"/\"version\": \"${NEW}\"/" \
    apps/netscli-gui/package-lock.json

# Packaging templates. The scoop manifests carry the version twice (the
# field and the asset URL), so those take a global replace. The PKGBUILDs
# and the Ruby files are anchored, because both carry the old version in a
# comment describing a past mistake and those must not move.
sed -i "s/${OLD}/${NEW}/g" \
    packaging/scoop/netscli.json \
    packaging/scoop/netscli-gui.json
sed -i "s/^pkgver=${OLD}/pkgver=${NEW}/" \
    packaging/aur/PKGBUILD \
    packaging/aur/netscli-gui-bin/PKGBUILD
sed -i "s/^  version \"${OLD}\"/  version \"${NEW}\"/" \
    packaging/homebrew/netscli.rb \
    packaging/homebrew/Casks/netscli-gui.rb

# Refresh the lockfile so the bumped versions are recorded.
cargo update -w
```

Then check every surface agrees before tagging. This should print `${NEW}`
and nothing else:

```bash
{
  grep -h '^version' crates/*/Cargo.toml apps/netscli-cli/Cargo.toml \
      apps/netscli-gui/src-tauri/Cargo.toml
  grep -h '"version"' apps/netscli-gui/package.json \
      apps/netscli-gui/src-tauri/tauri.conf.json
  head -n 10 apps/netscli-gui/package-lock.json | grep -h '"version"'
  grep -h '^pkgver=' packaging/aur/PKGBUILD \
      packaging/aur/netscli-gui-bin/PKGBUILD
  grep -h '^  version "' packaging/homebrew/netscli.rb \
      packaging/homebrew/Casks/netscli-gui.rb
  grep -hE '"version"|releases/download' packaging/scoop/netscli.json \
      packaging/scoop/netscli-gui.json
} | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u
```

Every grep above is anchored to the line that actually holds a version.
A bare `grep -oE` over these files would also match the version numbers
in their explanatory comments, and the check would report a second value
on every run until someone stopped believing it.

Finally, rename the `## [Unreleased]` heading in `CHANGELOG.md` to
`## [X.Y.Z]`, the version and nothing else. **The date and the link
reference do not go on here.** The next section says where they go and why.

## Dating the release

The ` - YYYY-MM-DD` and the `[X.Y.Z]: …/releases/tag/vX.Y.Z` reference are a
separate commit, made **after** the tag is pushed. That is forced.
`site/scripts/changelog-dates.mjs` asks `git tag --list` and fails a dated
version with no matching tag:

```
0.3.2: CHANGELOG.md dates it 2026-09-21, but there is no v0.3.2 tag.
The date goes on with the tag, not with the version bump.
```

Under branch protection a commit that dates a version before its tag exists
can never go green, because the tag it is waiting for comes after it. So the
sequence is:

1. Bump the versions and rename the heading to `## [X.Y.Z]` (above), and
   merge.
2. Tag the bump commit and push the tag. This builds nothing.
3. Date the heading, add the link reference, add the release's one-line
   `releaseSummaries` entry in `site/src/data/site-content/changelog.ts`,
   and merge.
4. Run `publish-preflight.yml`, then `publish-release.yml`.

The release body is generated from the `CHANGELOG.md` section and the
summary when the release goes public, so step 3 is also where the release
notes are written. [`RELEASE.md`](RELEASE.md#the-release-flow) has the whole
flow.

## GitHub Releases

Platform binaries and installers, and the download links the install
scripts resolve, come from the GitHub release, not crates.io.

`release.yml` builds them, and `publish-release.yml` calls it while the
release is still a draft. It refuses a release that is already public,
because a rebuild would change every digest the package managers have
published. To rebuild a draft's assets by hand:

```bash
gh workflow run release.yml -f tag=vX.Y.Z
```

Each of these is attached with its `.sha256`, `.sig` and `.pem`:

- **11 CLI binaries.** Linux x86_64 and aarch64 (gnu, each with a `-pcap`
  variant), Linux x86_64 musl (no `-pcap`), Windows x86_64 (plus `-pcap`),
  macOS x86_64 and aarch64 (each plus `-pcap`).
- **7 desktop files.** The Linux `.deb` and `.AppImage`, a `.dmg` for each
  macOS architecture, the `.app.tar.gz` each macOS app updates from, and the
  Windows `.msi`.

That is 72 files, and `latest.json` for the in-app updater makes 73.
`publish-release.yml` checks all of them before the release goes public.
The MCP bundles, with their sidecars, add 20 more once it is public.

Signing:

- **Sigstore**, keyless, with the Actions OIDC token, so no key material is
  stored. Consumers verify with the command in
  [`RELEASE.md`](RELEASE.md#verifying-release-signatures).
- **Authenticode** on every Windows executable and installer, since 0.3.3.
  See [`RELEASE.md`](RELEASE.md#windows-signing).
- **The updater key** on the four files `latest.json` names, each signature
  bound to the release's version, and checked against the app's public key
  before `latest.json` is uploaded.

The package managers check the SHA-256 in their own manifests.
`scripts/install.sh` also checks the Sigstore signature when `cosign` is
installed, and `scripts/install.ps1` the Authenticode signature.

**Windows pcap builds** link against the Npcap SDK, which `release.yml`
downloads and checks against a pinned SHA-256. Bumping the SDK version means
re-pinning that digest, in `ci.yml` too.

## netscli.com

`pages.yml` builds the Astro site in `site/` and deploys it to GitHub Pages.
It runs on pushes to `main` that touch the site or the files it reads, by
hand, and after every release, when `publish-release.yml` starts it.

- **The current version** is the newest release GitHub lists as published.
  The build asks GitHub before it starts, and the changelog page labels
  every newer `CHANGELOG.md` entry "Not yet released". If GitHub cannot be
  asked, the site names no version and dates no entry rather than guess.
- **`/install.sh` and `/install.ps1`** are `scripts/install.*`, generated
  by the build. Before deploying, a job that never ran `npm` checks both are
  byte for byte what the commit holds.
- **`/download/<tag>/netscli-gui-windows-x86_64.msi`** holds the MSI of the
  three newest releases that have one, for the Microsoft Store, which
  refuses an installer URL that redirects. Each is checked against its
  release's `.sha256` and, from v0.3.3 on, its Authenticode signature.

Only the deploy job holds `pages: write` and `id-token: write`.

## Site previews (Cloudflare Pages)

**Production is not involved.** netscli.com is served from GitHub Pages by
`pages.yml`. `site-preview.yml` deploys to a separate Cloudflare Pages
project, always with an explicit `--branch`. A pull request deploys to
`pr-<N>` and a push to `main` deploys to `main`, and that project treats
both as preview deployments. There is no code path in that workflow that
produces a production deploy.

### Enabling it

Until two repository secrets exist, the workflow fails with an error naming
them. It used to skip and report success, which hid the missing secrets for
weeks.

1. **Create the Pages project** (one-off, direct-upload mode). Do *not*
   connect it to Git, or Cloudflare will start building on its own and you
   will have two things deploying the site.

   ```bash
   npx wrangler@4 pages project create netscli-site-preview \
     --production-branch=unused-production-branch
   ```

   The production branch is deliberately a name nothing deploys to, so the
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
  `head` entry in `astro.config.mjs` for the Starlight docs pages. Those use
  Starlight's own layout, so the first mechanism alone leaves 11 of 14 pages
  crawlable.
- **The Cloudflare Web Analytics beacon is suppressed.** A preview is still a
  production Astro build (`import.meta.env.PROD` is true), so without this
  every PR deploy would report into netscli.com's real analytics property.

The workflow **verifies both before deploying** and fails the job rather than
publishing an indexable or analytics-reporting preview.

Neither affects a normal build. Production still emits the beacon, and only
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
registry that did not distinguish the two artifacts by name. Scoop has
`netscli`/`netscli-gui`, AUR `netscli-bin`/`netscli-gui-bin`, and winget
`fstubner.netscli`/`fstubner.netscli.gui`.

`publish-homebrew-cask.sh` deletes a leftover `Casks/netscli.rb` the first
time it runs against a tap that still has one. Prefer the fully-qualified
`fstubner/tap/...` form in documentation so it works without a separate
`brew tap` step.

`publish-homebrew.sh` regenerates the formula from
`packaging/homebrew/netscli.rb`, filling its `@@SHA256_*@@` placeholders with
digests it computed from the downloaded binaries, and refuses a result with a
placeholder left. `publish-homebrew-cask.sh` regenerates the Cask from a
quoted heredoc. Both jobs check out `main`, so a fix to the script or the
template reaches a re-run.

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

Two package identifiers in `microsoft/winget-pkgs`:

| Identifier | Job | Install |
| --- | --- | --- |
| `fstubner.netscli` | `winget` | `winget install fstubner.netscli` |
| `fstubner.netscli.gui` | `winget-gui` | `winget install fstubner.netscli.gui` |

Each job downloads Komac, refuses it unless its SHA-256 matches the value
pinned in `publish.yml`, and runs `komac update` with the release's installer
URL. Komac reads the latest manifests from winget-pkgs, writes the new
version's from the installer, and opens a PR from the token owner's fork.
Then `komac cleanup --only-merged` deletes the fork's branches whose PRs have
merged. The token is in the environment of those two steps and nowhere else.

This used to be `vedantmgoyal9/winget-releaser`. Its SHA pin did not pin
what received the token, because the action installs `cargo-binstall` from a
moving branch and then whichever Komac is newest. Bump Komac by changing
`KOMAC_VERSION` and `KOMAC_SHA256` together, from the `SHA256SUMS` file on
Komac's GitHub release.

**A moderator has to merge the PR**, usually within hours to days. This is
the one channel that is not fully automated, and the CLA must be signed once
per account.

Re-running a winget job does not open a second PR. Komac first searches
winget-pkgs for a PR whose title names the package and version, from any
author and in any state, and in CI it stops there and exits successfully.
That includes a PR a moderator closed, so after a rejection a re-run goes
green and submits nothing. To resubmit, fix what the moderator asked for and
run Komac by hand with `--skip-pr-check`:

```powershell
$env:GITHUB_TOKEN = "<the winget token>"
komac update fstubner.netscli --version X.Y.Z --urls https://github.com/fstubner/netscli/releases/download/vX.Y.Z/netscli-windows-x86_64.exe --submit --skip-pr-check
```

For the desktop app it is `fstubner.netscli.gui` with the
`netscli-gui-windows-x86_64.msi` URL.

winget checks the installer against the SHA-256 in its manifest. The
installers it points at are Authenticode-signed since 0.3.3, so Windows names
the publisher instead of "unknown publisher", by winget or by direct
download. SmartScreen can still warn about a file it has seen too rarely,
which a signature alone does not change.

The `packaging/winget/<pkg>/<version>/` directories are **reference copies**
of submitted manifests, one directory per version. Do not edit an existing
version's directory to hold a different version's content, because
winget-pkgs keys on the directory name and a mismatch files a conflicting
duplicate.

Needs `WINGET_TOKEN`, a classic PAT with `public_repo` and `workflow`, on a
bot account (see [`RELEASE.md`](RELEASE.md#the-winget-token)).

### PackageVersion carries no `v`, and five published versions do

`fstubner.netscli` has five catalog versions with a leading `v`, `v0.2.2`
to `v0.2.6`, beside `0.2.0` and the correctly named `0.3.2` and later. The
`winget` job passed the git tag straight through as `PackageVersion` before
that was fixed. `fstubner.netscli.gui` never had the problem. Its first
version, `0.2.6`, was submitted by hand.

**This does not break upgrades**, checked against the client rather than
assumed:

```
> winget list --id fstubner.netscli
netscli  fstubner.netscli  0.2.0  v0.2.6  winget      # offers the upgrade

> winget show fstubner.netscli --version 0.2.6        # resolves v0.2.6
> winget show fstubner.netscli --version 0.2.9        # finds nothing
```

The reason is not that winget strips the `v`. It does not. Nothing in
`Versions.cpp` trims a leading letter, and `Version::Assign` only trims
whitespace. What happens is that each dot-separated part is split into a
leading integer and a remainder, and a part with a non-empty remainder
sorts *below* one without. `v0` parses as integer `0` with remainder `v`,
and plain `0` parses as integer `0` with none. So `v0.2.6 < 0.2.6`, and
every `v0.2.x` in the catalog sits below any `0.3.x` on the first part
alone.

Same outcome, but the mechanism decides what happens next. Under
normalisation `v0.2.6` and `0.2.6` would be the *same* version, and
re-submitting `0.2.6` would be a duplicate. Under the real rule they are
two distinct versions and `0.2.6` is the higher one. A correctly formed
re-submission of an already-published number would land as an upgrade
rather than being rejected. Nothing plans to do that, but it is the kind of
thing the wrong mental model licenses.

The bad versions only ever displayed a version the project never issued,
and since 0.3.2 the newest version in the catalog is correctly named, which
is what `winget search` and `winget install` use. The old directories stay
in the catalog unless someone removes them. **Removing them is optional and
not automated.** It means a PR to `microsoft/winget-pkgs` deleting
`manifests/f/fstubner/netscli/v0.2.*/`, which breaks anyone pinned to one of
those versions with `winget install --version`. Doing nothing is a
defensible answer. A release should not prune them as a side effect.

The `Resolve PackageVersion` step asserts `MAJOR.MINOR.PATCH` and fails the
job otherwise. Stripping the `v` was already enough to produce the right
answer. The assertion exists because winget-pkgs accepted all five bad ones
without complaint, so nothing downstream will catch a recurrence.

## AUR

Two packages pushed over SSH by `KSXGitHub/github-actions-deploy-aur`, which
regenerates `.SRCINFO` server-side.

| Package | Job | Install |
| --- | --- | --- |
| `netscli-bin` | `aur` | `yay -S netscli-bin` |
| `netscli-gui-bin` | `aur-gui` | `yay -S netscli-gui-bin` |

Each job downloads the release assets, hashes the bytes and requires the
`.sha256` sidecar to agree, renders a bumped PKGBUILD from the template with
`sed`, and pushes. The render happens **inside `$GITHUB_WORKSPACE`**, not
`/tmp`, because the deploy action runs in a container that mounts the
workspace only, and a `/tmp` path produces a confusing
`bash: --command: invalid option` error.

AUR has **no review step**. A bad push is live immediately.

Needs `AUR_SSH_PRIVATE_KEY`.

## npm and the MCP Registry

The `npm` job publishes the `netscli` launcher and one package per platform,
each holding a prebuilt binary downloaded from the release and checked
against its digest. That is what makes `npx netscli serve` work as an MCP
command. It publishes with npm trusted publishing, an OIDC credential
minted for the run, so no npm token exists. `NPM_TOKEN` is needed only to
publish a package that does not exist yet, see
[`packaging/README.md`](../packaging/README.md).

The `mcp-registry` job lists `packaging/mcp-registry/server.json` in the MCP
Registry. It runs after `npm`, because the registry checks the npm package
it points at, and authenticates with the workflow's OIDC token.

## MCP bundles

The `mcpb` job builds five `.mcpb` bundles, one per platform, from the
published binaries, with `npx @anthropic-ai/mcpb`. It holds a read-only
token and no OIDC, because that tool's dependencies are resolved afresh on
every run. `mcpb-sign` then hashes and Sigstore-signs each bundle and
uploads it with its `.sha256`, `.sig` and `.pem`. Their signing identity is
`publish.yml`, not `release.yml`, see
[`RELEASE.md`](RELEASE.md#verifying-release-signatures).

## When a channel fails

Every job is independent. If nothing in the workflow or its scripts had to
change, use **Re-run failed jobs** on the publish run. If a fix had to merge,
dispatch the one job, which picks the fix up:

```bash
gh workflow run publish.yml -f tag=vX.Y.Z -f only=<job>
```

The job ids are `crates-io`, `npm`, `homebrew`, `scoop`, `winget`, `aur`,
`homebrew-cask`, `scoop-gui`, `winget-gui`, `aur-gui`, `mcpb` (which also
runs `mcpb-sign`) and `mcp-registry`. Without `-f only` every job runs
again. Each is safe to run twice (see
[`RELEASE.md`](RELEASE.md#when-something-fails)), but every registry is
contacted again.

Failure modes worth knowing:

| Symptom | Cause |
| --- | --- |
| `refusing to publish malformed tag` | The tag input is not `vMAJOR.MINOR.PATCH[-prerelease]`. Deliberate, because the tag reaches `sed` replacements and commit messages. |
| `checksum mismatch for <asset>` | The `.sha256` sidecar disagrees with the actual bytes. The scripts download and re-hash rather than trusting the sidecar, so investigate before overriding. |
| `<asset>.sha256 is not a 64-char hex digest` | Sidecar truncated or missing. Previously this silently produced a manifest with blank hashes. |
| `never became available` after 15 min | The asset is not on the release. On the normal path every asset is checked before the release goes public, so this means the release was promoted by hand. Check the release first. |
| `komac.exe digest ..., expected ...` | The Komac download does not match the pinned digest. Do not re-pin without checking the new digest against Komac's own `SHA256SUMS`. |
| winget job ends with "There is already an open pull request" or "a merged" one | Komac found the PR for this version and stopped. Nothing to fix. |
| winget job ends with "There is already a closed pull request" | A moderator closed the PR and nothing was resubmitted. See [winget](#winget) for resubmitting. |
| a hand-run `cargo publish` fails on a crate that already has the version | crates.io refuses a version it has. The job leaves those crates out, and by hand you list only the ones still missing. |

Because crates.io publishes are **permanent**, a crate that went up broken
means bumping the patch version, not retrying the same one.
