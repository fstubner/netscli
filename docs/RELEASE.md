# Release process

netscli ships through six distribution channels. Every step after "publish
the GitHub release" is automated by
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml).

This document is the **process** — what a human does, in order. For a
per-channel reference (what each channel is, what it needs, how to fix it
when it breaks), see [`PUBLISHING.md`](PUBLISHING.md).

## One-time secret setup

Before the first automated release runs, add these secrets at
**GitHub → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it | Used by |
|--------|-----------------|---------|
| `CARGO_REGISTRY_TOKEN` | [crates.io → Account Settings → API Tokens](https://crates.io/settings/tokens) → "New Token" with `publish-update` scope (limit to `netscli-core`, `netscli-mcp`, `netscli` if you want least-privilege) | `crates-io` job |
| `HOMEBREW_TAP_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) → fine-grained or classic PAT with `Contents: Read & Write` on `fstubner/homebrew-tap` | `homebrew` job |
| `SCOOP_BUCKET_TOKEN` | Same shape as Homebrew but for `fstubner/scoop-bucket`. May reuse the same PAT if scoped widely. | `scoop` job |
| `WINGET_TOKEN` | Classic PAT with `public_repo` scope. The releaser action forks `microsoft/winget-pkgs` under your account and opens a PR — needs to write to your fork. | `winget` job |
| `AUR_SSH_PRIVATE_KEY` | The private half of the `~/.ssh/aur` key already registered with your AUR account (we generated this earlier). Paste the full file content (`-----BEGIN OPENSSH PRIVATE KEY-----` through `-----END OPENSSH PRIVATE KEY-----` inclusive). | `aur` job |

## The release flow

1. **Bump versions + CHANGELOG**, merge to main. Seven files have to move
   together — see
   [`PUBLISHING.md`](PUBLISHING.md#version-bumps) for the list and a
   verification command; missing the GUI's three is what got the v0.2.4
   winget submission rejected.
   Before tagging, run the local release gate:
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
   > remote-debugging port. Tracked at wry#1782; nothing on our side fixes
   > it. `gui-render.yml` is schedule-only for the same reason. Desktop
   > coverage is manual until a scheduled run goes green — see the installer
   > smoke below, which is a real check and still required.
   On Windows, PCAP-enabled source builds also need the Npcap SDK import
   library on `LIB` (for x64 MSVC, the directory containing `wpcap.lib` is
   usually `<Npcap SDK>\Lib\x64`) and `C:\Windows\System32\Npcap` on `PATH`
   for runtime checks.
   For the desktop installer smoke, run:
   ```powershell
   cd apps/netscli-gui
   npm run tauri build

   # Installed-binary render smoke. The render harness skips its own
   # Tauri build when TAURI_APP_PATH is set.
   #
   # Expected to fail today for the WebView2/wry#1782 reason noted above.
   # Run it to see whether that has changed, but do not gate the release on
   # it -- launch the installed app by hand instead and confirm it renders.
   $env:TAURI_APP_PATH = "C:\Program Files\NetsCLI\netscli-gui.exe"
   npm run test:tauri-render
   Remove-Item Env:\TAURI_APP_PATH
   ```
   For installer smoke, validate both Windows bundles:
   - **NSIS:** install silently to a temporary user-writable directory,
     run the installed-binary render smoke with `TAURI_APP_PATH`, then
     uninstall silently and verify the app files plus
     `HKCU:\Software\netscli\NetsCLI` install-location key are gone.
   - **MSI:** install elevated, verify `InstallLocation` is
     `C:\Program Files\NetsCLI\`, run the installed-binary render smoke,
     install the next MSI over it to verify upgrade behavior, then
     uninstall elevated and keep the installer logs with the release
     notes.

   The MSI uses a custom WiX template so stale NSIS remembered install
   paths cannot redirect a clean MSI install into an old temporary
   directory. Treat any regression in these installer checks as a
   release-validation blocker.

   The published desktop GUI installers are intentionally built without
   `--features pcap`. This keeps the GUI install path free of libpcap/Npcap
   runtime dependencies and avoids redistributing Npcap. The GUI may still
   show the Packet Capture tool, but it must present setup guidance and remain
   non-runnable unless the backend is PCAP-capable and the user has installed
   the required system runtime themselves. If a future release adds
   PCAP-enabled GUI installers, validate launch behavior on Windows with and
   without Npcap installed before publishing that flavor. For local Windows
   PCAP GUI experiments, use
   `scripts/dev-gui-pcap.ps1` or otherwise set `CARGO_TARGET_DIR=target-pcap`
   so a PCAP-linked debug binary does not replace the normal non-PCAP
   `target/debug/netscli-gui.exe`.

   Also check dependency freshness:
   ```bash
   cargo update --dry-run
   npm outdated --prefix apps/netscli-gui
   ```
   If these report compatible updates, refresh the lockfiles and rerun
   the full gate before tagging.
2. **Tag and draft the release.** Either `gh release create vX.Y.Z --draft
   --generate-notes` or use the web UI's "Draft a new release" button.
3. **Edit the release notes.** The public changelog page renders the GitHub
   release body directly, so do not publish PR-title-only notes for a visible
   product milestone. Add a short human-written overview before the generated
   change list:
   - what changed for users,
   - why it changed,
   - who benefits,
   - upgrade, packaging, or runtime caveats.

   For example, the GUI redesign release should explain the move from the
   simple dashboard-style shell to the tabbed desktop workflow, why richer
   result details and filters were added, and what stayed compatible.
4. **Promote the draft to public.** This is the one human action that
   stays in the loop.
   ```bash
   gh release edit vX.Y.Z --draft=false --repo fstubner/netscli
   ```
   This single event fires both `release.yml` (builds binaries + GUI
   installers, attaches them to the release) and `publish.yml` (fans out
   to package managers).
5. **Watch the dashboard.** From the release page or the Actions tab:
   - `Release` workflow: 11 CLI assets + 5 GUI installers attached.
   - `Publish to package managers` workflow: 9 jobs — a CLI and a GUI job
     for each of Homebrew, Scoop, winget and AUR, plus `crates-io`.

   The `homebrew`, `scoop`, and `aur` jobs poll for asset availability
   (up to 15 minutes) so they tolerate the parallel race against
   `release.yml`.

6. **If something fails**, re-run just that job from the Actions tab —
   `workflow_dispatch` accepts a tag input so you can re-run a specific
   channel without rebuilding binaries or re-running the others.

## What still needs human attention

- **Winget moderator approval.** The action opens a PR to
  `microsoft/winget-pkgs`; a community moderator merges it within a few
  hours to days. CLA must be signed once per account (you've done this).
- **GUI-channel manifests are now automated.** Four GUI jobs live in
  `publish.yml` alongside their CLI siblings — `homebrew-cask`,
  `scoop-gui`, `winget-gui`, `aur-gui` — and re-stamp the manifests on
  every release the same way the CLI ones do. Templates remain under
  [`packaging/`](../packaging/) for reference; deployed copies live in
  the tap / bucket / AUR / winget-pkgs.

## Sigstore signature verification

`release.yml` signs every CLI and GUI asset keylessly via `cosign sign-blob`,
using the GitHub Actions OIDC token as the signing identity (no cosign key
material is stored anywhere). Each asset gets a `.sig` and `.pem` uploaded
alongside it. This is documented for consumers in README.md's
"Verifying Release Signatures" section, but nothing in the current install
scripts or packaging manifests (Homebrew/Winget/Scoop/AUR) verifies it
automatically — those channels rely on their own hash-verification instead
(see below). If a downstream package manager integration is ever added that
wants to verify the cosign signature automatically, the verify command is:

```bash
cosign verify-blob \
  --signature <asset>.sig --certificate <asset>.pem \
  --certificate-identity-regexp 'https://github.com/fstubner/netscli/.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  <asset>
```

## Windows trust and signing policy

Windows Authenticode signing is deferred for now. The recommended Windows
install path is Winget:

```powershell
winget install fstubner.netscli.gui
```

Winget validates the installer against the SHA256 hash in the submitted
manifest after the `microsoft/winget-pkgs` review path. Keep that package
ID and hash-verified install path prominent in README and release notes.

Direct GitHub MSI/NSIS downloads remain available, but they are currently
unsigned and can show "unknown publisher" or SmartScreen warnings. Do not
claim that Winget replaces Authenticode signing; describe it as the
preferred hash-verified install channel until a paid or Store signing path
is adopted.

## Future Microsoft Store channel

NetsCLI Desktop can be submitted to the Microsoft Store later as an
`EXE or MSI app`, but it is a separate distribution channel from Winget.
Before attempting it, prepare:

- Partner Center developer enrollment and reserved app name.
- A Store-specific Tauri Windows bundle config using the **offline**
  WebView2 installer mode. The default bundle now uses
  `embedBootstrapper` (`apps/netscli-gui/src-tauri/tauri.conf.json`),
  which removes the elevated network fetch the old `downloadBootstrapper`
  default performed at install time but still needs a connection for the
  runtime itself. The Store requires `offlineInstaller`, which embeds the
  full runtime and adds roughly 130 MB to the installer -- worth taking
  only for that channel, or if offline installs become a requirement.
- Authenticode signing with a certificate that chains to a CA in the
  Microsoft Trusted Root Program. Sigstore release signatures are useful
  for artifact provenance, but they do not replace Store-required Windows
  code signing for EXE/MSI submissions.
- A versioned HTTPS installer URL for each submitted release. Do not
  reuse mutable `latest` URLs for Store submissions.
- Silent standalone install behavior for the MSI/EXE. UAC is allowed,
  but the installer should not show normal setup UI and must not be a
  downloader stub.

Relevant references:
[Tauri Microsoft Store guide](https://v2.tauri.app/distribute/microsoft-store/)
and
[Microsoft EXE/MSI package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements).

## Future update notifications

Winget users update through `winget upgrade fstubner.netscli.gui` or
`winget upgrade --all`; Winget does not push app-owned update toasts.
If the GUI should proactively announce new releases, add a desktop-side
update check that compares the running version with GitHub Releases or a
Tauri updater manifest, then show a short in-app toast with a link to the
release. Keep installation itself owned by the selected channel
(Winget, GitHub installer, Homebrew cask, Scoop, AUR, or a future Store
listing) so the app does not invent a competing updater path.

## GUI install commands

| Platform | Command |
|----------|---------|
| Windows | `winget install fstubner.netscli.gui` |
| macOS | `brew install --cask fstubner/tap/netscli` |
| Linux (any distro, AppImage) | `yay -S netscli-gui-bin` |
| Windows (Scoop) | `scoop install netscli-gui` |

## Action pin policy

Every third-party action in `release.yml` and `publish.yml` is pinned to a
**commit SHA**, with the human-readable version in a trailing comment:

```yaml
uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3
```

Both workflows hold `contents: write` and `id-token: write`, so a retagged
or compromised action could exfiltrate the OIDC token and mint Fulcio
certificates as this repository. Tag refs are mutable; SHAs are not.

Dependabot updates SHA pins and rewrites the comment. When bumping by hand,
resolve the tag first:

```bash
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
```

The workflows that only hold `contents: read` (`ci.yml`, `site.yml`,
`audit.yml`, `gui-render.yml`) still use tag refs — the blast radius there
is a failed build, not a forged signature.
