# Release process

This document is the **process**, what a human does and in what order. For a
per-channel reference (what each channel is, what publishes to it, how to fix
it when it breaks), see [`PUBLISHING.md`](PUBLISHING.md).

One workflow run does the release, once the tag and the changelog are in
place. [`publish-release.yml`](../.github/workflows/publish-release.yml)
builds every asset into the draft release, checks that all of them are
there, and only then makes the release public and starts the package
managers ([`publish.yml`](../.github/workflows/publish.yml)) and the site
([`pages.yml`](../.github/workflows/pages.yml)). Until the last step the
release is a draft that nobody can see, so a build that fails leaves nothing
broken in public.

## One-time setup

### Repository secrets

Set these under **GitHub → Settings → Secrets and variables → Actions →
New repository secret**.

| Secret | Where to get it | Used by |
|--------|-----------------|---------|
| `CARGO_REGISTRY_TOKEN` | [crates.io → Account Settings → API Tokens](https://crates.io/settings/tokens), "New Token" with the `publish-update` scope, limited to `netscli-core`, `netscli-mcp` and `netscli` | `crates-io` job |
| `HOMEBREW_TAP_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens), a fine-grained or classic PAT with `Contents: Read & Write` on `fstubner/homebrew-tap` | `homebrew`, `homebrew-cask` jobs |
| `SCOOP_BUCKET_TOKEN` | The same shape as the Homebrew token, for `fstubner/scoop-bucket`. One PAT can serve both if it covers both repositories. | `scoop`, `scoop-gui` jobs |
| `WINGET_TOKEN` | A classic PAT with the `public_repo` and `workflow` scopes, created on the account whose fork of `microsoft/winget-pkgs` the PRs come from. See [The winget token](#the-winget-token). | `winget`, `winget-gui` jobs |
| `AUR_SSH_PRIVATE_KEY` | The private half of the SSH key registered with your AUR account. Paste the whole file, from `-----BEGIN OPENSSH PRIVATE KEY-----` to `-----END OPENSSH PRIVATE KEY-----`. | `aur`, `aur-gui` jobs |

Three more groups exist for narrower uses, each documented where it is used.
`NPM_TOKEN` is needed only to publish an npm package that does not exist yet
([`packaging/README.md`](../packaging/README.md)). The `MSSTORE_*` secrets
automate Microsoft Store submissions
([`MICROSOFT-STORE.md`](MICROSOFT-STORE.md)). The two `CLOUDFLARE_*` secrets
deploy site previews ([`PUBLISHING.md`](PUBLISHING.md#site-previews-cloudflare-pages)).

### The `release-signing` environment

Four more secrets live on the `release-signing` environment
(**Settings → Environments → release-signing**) rather than on the
repository, so only the jobs that sign can read them.

| Secret | Where to get it | Used by |
|--------|-----------------|---------|
| `CERTUM_EMAIL` | The e-mail address of your Certum account. | `gui` (Windows) and `sign-windows` jobs |
| `CERTUM_OTP` | The TOTP seed from SimplySign, base32, or the full `otpauth://` URI. Treat it like a private key. | the same |
| `TAURI_SIGNING_PRIVATE_KEY` | The private key from `npm run tauri -- signer generate -w ~/.tauri/netscli-updater.key`, run in `apps/netscli-gui`. Its public half goes in `plugins.updater.pubkey` in `tauri.conf.json`. | `gui` and `sign-windows` jobs (updater signatures) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you gave that command. | the same |

Set **Deployment branches and tags** on the environment to the branch `main`
and the tag pattern `v*`. Every job that uses the environment runs from a
workflow dispatched on `main`, so nothing in the release needs more, and a
workflow pushed to any other branch cannot read the secrets. Add no required
reviewers. A reviewer would hold the release at its first signing job, which
the draft can afford, but a stolen maintainer token can approve its own
deployment through the API, so it would protect against nothing the branch
policy does not.

**Back up the updater private key somewhere other than this machine.** Every
installed copy of the desktop app accepts updates signed by that key and no
other. Lose it, and those copies can no longer update from inside the app. A
new key means a new build, which everyone then has to install once
themselves, by hand or through their package manager.

### The winget token

`komac`, the tool the winget jobs run, forks `microsoft/winget-pkgs` under
the account that owns `WINGET_TOKEN` and opens its PRs from there. It needs a
classic PAT. Fine-grained tokens cannot open a PR on a repository their owner
does not own. The token needs `workflow` as well as `public_repo`, because
creating a branch on the fork fails without it ("does not have the correct
permissions to execute CreateRef"). GitHub's token page pairs `workflow` with
the whole `repo` group.

So make the token on a separate account that exists only for this. A classic
token with those scopes can write to every repository its owner can, and on
your own account that includes this one. On a bot account with no access to
`fstubner/*`, the most it can touch is that account's fork. The account needs
the winget-pkgs CLA signed once. `publish-preflight.yml` reports which
account the token belongs to and fails if it lacks `workflow`.

## The release flow

1. **Bump the versions and the changelog heading**, and merge. Seven files
   have to move together, see [`PUBLISHING.md`](PUBLISHING.md#version-bumps)
   for the list and a command that checks them. Missing the GUI's three is
   what got the v0.2.4 winget submission rejected. The changelog half of
   this step is the heading rename only, `## [Unreleased]` to
   `## [X.Y.Z]`. The date and the link come later, in step 3.

   Before merging, run the local release gate:
   ```bash
   cargo fmt --check
   cargo test --all --no-fail-fast
   cargo clippy --all-targets -- -D warnings
   cargo clippy --all-targets --features pcap -- -D warnings
   cargo audit
   cd apps/netscli-gui && npm run lint && npm run test:unit && npm run test:maintainability && npm run build
   ```
   > **`npm run test:tauri-render` is not part of this gate right now, and a
   > release must not block on it.** WebView2 Runtime 150+ ignores
   > `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` on an elevated host, by design
   > per Microsoft, so tauri-driver cannot hand msedgedriver its
   > remote-debugging port. Tracked at wry#1782, and nothing on our side
   > fixes it. `gui-render.yml` is schedule-only for the same reason.

   On Windows, PCAP-enabled source builds also need the Npcap SDK import
   library on `LIB` (for x64 MSVC, the directory containing `wpcap.lib` is
   usually `<Npcap SDK>\Lib\x64`) and `C:\Windows\System32\Npcap` on `PATH`
   for runtime checks.

   The published desktop GUI installers are intentionally built without
   `--features pcap`. This keeps the GUI install path free of libpcap/Npcap
   runtime dependencies and avoids redistributing Npcap. The GUI may still
   show the Packet Capture tool, but it must present setup guidance and remain
   non-runnable unless the backend is PCAP-capable and the user has installed
   the required system runtime themselves. If a future release adds
   PCAP-enabled GUI installers, validate launch behavior on Windows with and
   without Npcap installed before publishing that flavor. For local Windows
   PCAP GUI experiments, use `scripts/dev-gui-pcap.ps1` or otherwise set
   `CARGO_TARGET_DIR=target-pcap`, so a PCAP-linked debug binary does not
   replace the normal non-PCAP `target/debug/netscli-gui.exe`.

   The installer itself is checked in CI.
   [`installer-upgrade.yml`](../.github/workflows/installer-upgrade.yml)
   installs the last release's MSI and then this branch's over it, on every
   pull request that touches `tauri.conf.json` or the WiX template, and
   checks what a user is left with. The in-app update is not, see step 5.

   Also check dependency freshness, and if there are compatible updates,
   refresh the lockfiles and run the gate again:
   ```bash
   cargo update --dry-run
   npm outdated --prefix apps/netscli-gui
   ```

2. **Tag the bump commit and push the tag.**
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   Pushing a tag builds nothing. It does make release-drafter's next run
   retitle its draft to this version. If the draft still shows another
   version, run the **Release Drafter** workflow from the Actions tab.

3. **Date the changelog and write the one-line summary**, and merge. In one
   pull request:
   - give the heading its date, `## [X.Y.Z] - YYYY-MM-DD`, the day you mean
     to publish, and add the `[X.Y.Z]: …/releases/tag/vX.Y.Z` link reference.
     The order is forced, see
     [Dating the release](PUBLISHING.md#dating-the-release).
   - add `releaseSummaries['vX.Y.Z']` to
     `site/src/data/site-content/changelog.ts`, one sentence on what the
     release means for someone using it.

   The release body is written from these two by `scripts/release-notes.mjs`
   just before the release goes public, and it replaces whatever the draft
   held. So edit `CHANGELOG.md`, not the draft. A note typed into the draft
   is lost.

4. **Check the credentials.**
   ```bash
   gh workflow run publish-preflight.yml
   ```
   It checks the five publishing credentials and the four signing ones, and
   publishes nothing. The updater key and its password sign a scratch file,
   which is then checked against the public key the app embeds. GitHub PATs
   commonly carry a 90-day expiry and releases here are months apart, so run
   it every time.

5. **Check an in-app update by hand** when the release changes the updater,
   the installer, Tauri, or how update files are signed, and for the first
   release an installed app updates to. Nothing in CI installs an update
   through the app. See [Staged in-app update check](#staged-in-app-update-check).

6. **Publish.**
   ```bash
   gh workflow run publish-release.yml -f tag=vX.Y.Z
   ```
   Always through this workflow, never `gh release edit --draft=false` and
   never the web UI's publish button. `release-drafter` rewrites its draft on
   every push to `main`, and if the release goes public in the middle of that
   rewrite, the rewrite turns it back into a draft or worse. One second of
   overlap is enough, and that is how v0.3.1 lost its tag.
   `publish-release.yml` holds a lock the drafter shares. The other two
   routes hold nothing, and they also skip the build and the asset check.

   The run does, in order:
   - **prepare.** Refuses a malformed tag, a run that is not on `main`, a tag
     that was not pushed, a release that is not a draft, and a version with
     no `CHANGELOG.md` section.
   - **build.** Runs [`release.yml`](../.github/workflows/release.yml)
     against the draft. Every CLI binary and desktop installer is built,
     signed (Authenticode for the Windows files, Sigstore for all) and
     uploaded to the draft with its `.sha256`, `.sig` and `.pem`, then
     `latest.json` is built for the in-app updater and every update
     signature in it is checked against the app's public key.
   - **promote.** Checks the draft carries all 18 files with their three
     sidecars, that every `.sha256` matches the digest GitHub computed for the
     uploaded file, and that `latest.json` announces this version, points at
     this tag, and carries signatures bound to this version. Then it writes
     the release body, makes the release public, reads it back to prove it is
     public and still carries its tag, and starts `publish.yml` and
     `pages.yml`.

   The lock is held for the whole run, so release-drafter waits until the
   release is public. There is one thing it cannot prevent. When a drafter
   run is already going, this run waits for it, and GitHub cancels a waiting
   run if another push to `main` arrives in that time. That happens before
   anything is done, so dispatch it again.

7. **Watch it.**
   - The **Publish release** run, with the build's jobs inside it as
     `Build / ...`. The release stays a draft until its last job.
   - **Publish to package managers**, 13 jobs and a summary. Its summary table
     says which registries took the release.
   - **Deploy GitHub Pages**, which updates the version netscli.com names and
     copies the new MSI to `netscli.com/download/vX.Y.Z/` for the Microsoft
     Store.

8. **After publishing.**
   - Update one installed copy of the previous release from inside the app,
     on Windows at least. It is the first real use of the published
     `latest.json`.
   - Winget PRs need a moderator to merge them, usually within hours to
     days.
   - Submit the Store listing once the site has deployed, with
     `gh workflow run msstore.yml -f tag=vX.Y.Z` (see
     [`MICROSOFT-STORE.md`](MICROSOFT-STORE.md)).

## When something fails

**The build fails** (a signing step, one platform's build). The release is
still a draft, so nothing public is affected. Fix the cause, then open the
failed **Publish release** run and use **Re-run failed jobs**. It re-runs the
failed jobs and every job after them, including `promote`. `sign-windows`
and the `latest.json` job read their scripts from `main` when they run, so a
fix merged to a script reaches the re-run. A fix to a workflow file does not,
because a re-run uses the workflow as it was. For that, dispatch
`publish-release.yml` again, which rebuilds every asset into the draft and
replaces what is there. The unsigned Windows files are kept for one day, so
after a day a re-run of `sign-windows` finds nothing to sign. Dispatch again
instead.

**The asset check fails.** Its log names every missing or mismatched file.
Usually a build job uploaded only part of its files. Re-run the failed jobs
as above.

**Promoting fails.** If the release is still a draft, re-run the failed jobs.
If it went public and the job failed afterwards, its error says which of
`publish.yml` and `pages.yml` did not start. Start them by hand. A re-run
will not do it for you, on purpose, because it cannot tell whether
`publish.yml` already started, and a second fan-out contacts every registry
again.

**A package manager job fails.** If nothing in the workflow or its scripts
had to change, use **Re-run failed jobs** on the publish run. If a fix had to
merge, dispatch that one job, which picks the fix up:
```bash
gh workflow run publish.yml -f tag=vX.Y.Z -f only=<job>
```
The job ids are `crates-io`, `npm`, `homebrew`, `scoop`, `winget`, `aur`,
`homebrew-cask`, `scoop-gui`, `winget-gui`, `aur-gui`, `mcpb` (which also
runs `mcpb-sign`) and `mcp-registry`. A run without `only` runs all of them
again.

Re-running is safe for each of them. `crates-io` skips crates that already
have the version. `npm` and `mcp-registry` skip what their registries
already have. Komac stops when it finds its own PR for the version. The tap
and bucket scripts, and the AUR action, commit nothing when nothing changed.
`mcpb` uploads with `--clobber`.

## Staged in-app update check

Nothing in CI tests the in-app updater. No job installs an update the way a
user does, through the app, with its UAC prompt and relaunch. This is the
check by hand, against a local copy of the release flow. It uses its own
throwaway key and a local server, so it can run before anything is
published. Do it on a Windows machine or VM where NetsCLI is not installed,
because the test builds use the real app's identity and would replace it.
Every command runs in `apps/netscli-gui`.

1. Make a throwaway key pair. With `--ci` it has no password.
   ```powershell
   npm run tauri -- signer generate --ci -w $env:TEMP\staged.key
   ```
2. Write `$env:TEMP\staged-old.json`, which turns this build into version
   0.98.0 that trusts the throwaway key and checks a local server. Put the
   contents of `$env:TEMP\staged.key.pub` in `pubkey`.
   ```json
   {
     "version": "0.98.0",
     "plugins": {
       "updater": {
         "pubkey": "<contents of staged.key.pub>",
         "endpoints": ["http://127.0.0.1:8765/latest.json"],
         "dangerousInsecureTransportProtocol": true
       }
     }
   }
   ```
   Copy it to `$env:TEMP\staged-new.json` and change the version to
   `0.99.0`.
3. Build and install the old one, then build the new one.
   ```powershell
   npm run tauri -- build --bundles msi --config $env:TEMP\staged-old.json
   msiexec /i (Resolve-Path ..\..\target\release\bundle\msi\NetsCLI_0.98.0_x64_en-US.msi)
   npm run tauri -- build --bundles msi --config $env:TEMP\staged-new.json
   ```
4. Serve the new MSI with an updater signature bound to its version, as the
   release signs it. Leave the password prompt empty.
   ```powershell
   $serve = New-Item -ItemType Directory -Force $env:TEMP\staged-serve
   Copy-Item ..\..\target\release\bundle\msi\NetsCLI_0.99.0_x64_en-US.msi $serve\netscli-gui-windows-x86_64.msi
   npm run tauri -- signer sign -f $env:TEMP\staged.key --app-version 0.99.0 $serve\netscli-gui-windows-x86_64.msi
   ```
   Then write `$serve\latest.json`, with the contents of the `.msi.sig` file
   in `signature`, and serve the folder:
   ```json
   {
     "version": "0.99.0",
     "notes": "Staged update check",
     "pub_date": "2026-01-01T00:00:00Z",
     "platforms": {
       "windows-x86_64-msi": {
         "signature": "<contents of netscli-gui-windows-x86_64.msi.sig>",
         "url": "http://127.0.0.1:8765/netscli-gui-windows-x86_64.msi"
       }
     }
   }
   ```
   ```powershell
   python -m http.server 8765 --bind 127.0.0.1 --directory $serve
   ```
5. Start the installed 0.98.0. With update checks on in Settings, it offers
   0.99.0. Install it, accept the UAC prompt, and check that the app closes,
   the installer runs without asking anything, the app comes back, and
   **About** says 0.99.0.
6. Uninstall NetsCLI and delete `staged.key`.

To see the version binding refuse something, sign the MSI again without
`--app-version`, reinstall 0.98.0, and start it. The update should fail with
an error about the signature not specifying its version.

## Verifying release signatures

Every release asset that carries a program has a Sigstore signature, made
keylessly with `cosign sign-blob` and the GitHub Actions OIDC token, so no
signing key is stored anywhere. Each asset `<asset>` has `<asset>.sig` and
`<asset>.pem` beside it. For the binaries and installers:

```bash
cosign verify-blob \
  --signature <asset>.sig --certificate <asset>.pem \
  --certificate-identity-regexp '^https://github\.com/fstubner/netscli/\.github/workflows/release\.yml@refs/(heads/main|tags/v[0-9.]+)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  <asset>
```

The identity names `release.yml` on `main`, where every release since
v0.3.1 was built, or on a release tag, where earlier ones were. A looser
`release\.yml@.*` would accept a signature made by that file on any branch
anyone with write access pushes. The `.mcpb` bundles are signed after the
release is public, by `publish.yml`, so for them use
`'^https://github\.com/fstubner/netscli/\.github/workflows/publish\.yml@refs/(heads/main|tags/v[0-9.]+)$'`.
The tag arm covers a release promoted by hand, which starts `publish.yml`
from the tag.

`scripts/install.sh` runs this check when `cosign` is installed and refuses
a binary that fails it. The package managers check the SHA-256 in their own
manifests instead.

## Windows signing

Every Windows executable and installer is Authenticode-signed with a Certum
cloud certificate, since 0.3.3. The `sign-windows` job signs the two CLI
`.exe` files and the MSI, on Linux, with `scripts/release/sign-windows.sh`.
The desktop app's own `.exe` has to be signed before WiX packs it into the
MSI, so the bundler does that during the build, through
`scripts/release/sign-windows-pe.ps1`. Both read back every signature they
make, and the build unpacks the finished MSI and checks the program inside.
`scripts/install.ps1` checks the signature of the `netscli.exe` it
downloads.

## The in-app updater

The desktop app checks
`https://github.com/fstubner/netscli/releases/latest/download/latest.json`
and installs an update only if its signature verifies against the public key
compiled into the app. The app also sets `requireSignedVersion`, so it
refuses an update whose signature is not bound to the version `latest.json`
announces. That stops an edited `latest.json` from pairing a new version
number with an older installer. Every update file is signed with
`--app-version`, and `scripts/release/updater-manifest.mjs` refuses to build
`latest.json` from a signature without it.

## GUI install commands

| Platform | Command |
|----------|---------|
| Windows | `winget install fstubner.netscli.gui` |
| Windows (Scoop) | `scoop install netscli-gui` |
| macOS | `brew install --cask fstubner/tap/netscli-gui` |
| Arch Linux | `yay -S netscli-gui-bin` |
| Other Linux | the `.AppImage` or `.deb` from the release |

## Pins

Every third-party action in every workflow is pinned to a **commit SHA**,
with the human-readable version in a trailing comment:

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Tag refs are mutable and SHAs are not, and the release workflows hold
`contents: write` and `id-token: write`, so a retagged action could forge a
signature as this repository. Dependabot updates the SHA pins and rewrites
the comment. When bumping by hand, resolve the tag first:

```bash
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
```

The tools the workflows download are pinned by version and by SHA-256. They
are Komac, ssign, the Certum intermediate certificate, the Npcap SDK,
appimagetool and mcp-publisher, and Dependabot cannot see them. Bump them by hand, from the
upstream release's own checksums, and say where the digest came from in the
comment beside it.
