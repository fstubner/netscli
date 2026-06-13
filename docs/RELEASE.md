# Release process

netscli ships through five distribution channels. As of v0.2.1 every step
after "publish the GitHub release" is automated by
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml).

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

1. **Bump versions + CHANGELOG**, merge to main. (Already done for v0.2.1
   via [#30](https://github.com/fstubner/netscli/pull/30).)
   Before tagging, run the local release gate:
   ```bash
   cargo fmt --check
   cargo test --all --no-fail-fast
   cargo clippy --all-targets -- -D warnings
   cargo clippy --all-targets --features pcap -- -D warnings
   cargo audit
   cd apps/netscli-gui && npm run test:unit && npm run test:maintainability && npm run build && npm run test:tauri-render
   ```
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
   - `Release` workflow: 13 CLI assets + 4 GUI installers attached.
   - `Publish to package managers` workflow: 5 jobs, one per channel.

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
- A Store-specific Tauri Windows bundle config using the offline
  WebView2 installer mode.
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
| macOS | `brew install --cask netscli` |
| Linux (any distro, AppImage) | `yay -S netscli-gui-bin` |
| Windows (Scoop) | `scoop install netscli-gui` |

## Action pin policy

The two third-party actions used by `publish.yml` are referenced by
version tag, not commit SHA:
- `vedantmgoyal2009/winget-releaser@v2`
- `KSXGitHub/github-actions-deploy-aur@v4.1.3`

These are stable, widely-used actions; pinning to SHA is on the radar
but not blocking. If you want stricter supply-chain hygiene, swap each
`@vN` for the matching `@<sha>` and let Dependabot bump them.
