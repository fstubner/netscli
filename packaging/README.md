# Packaging

Manifest templates, generated package metadata, and submission notes for
getting NetsCLI into the major OS package managers.

Most live package-manager updates are automated from
`.github/workflows/publish.yml` after a GitHub release is published. The
files in this directory are reference templates/snapshots and should stay
accurate enough to review. The publish jobs download each release asset,
re-hash it, and check the result against the uploaded `.sha256` sidecar
before pushing downstream updates — so a sidecar that disagrees with its
asset fails the publish rather than propagating.

Earlier revisions of this file described the sidecar as the source of the
hash, which made verification circular: the sidecar came from the same
origin as the asset, so it could only ever detect corruption in transit,
never a compromised artifact (C-35, B-03).

## How the release pipeline feeds these

Publishing a GitHub release triggers `.github/workflows/release.yml`,
which for each platform:

1. Builds the binary with `cargo build --release --locked`.
2. Writes a `.sha256` alongside it.
3. Signs it via [sigstore keyless](https://docs.sigstore.dev/cosign/signing/overview/)
   using the GitHub Actions OIDC token, producing `.sig` + `.pem`.
4. Uploads all four files as release assets.

Package manifests reference the release asset URL plus the SHA256. The
`.sig` + `.pem` let security-conscious users verify provenance without
trusting GitHub's binary storage:

```bash
cosign verify-blob \
  --certificate netscli-linux-x86_64.pem \
  --signature   netscli-linux-x86_64.sig \
  --certificate-identity-regexp 'https://github.com/fstubner/netscli/.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  netscli-linux-x86_64
```

## Submission targets

| Registry | Dir | Publish path |
|---|---|---|
| npm | [`npm/`](./npm/) | `scripts/release/publish-npm.sh` |
| MCP bundles | [`mcpb/`](./mcpb/) | `scripts/release/build-mcpb.sh` |
| Homebrew tap | [`homebrew/`](./homebrew/) | `scripts/release/publish-homebrew.sh` |
| Homebrew Cask | [`homebrew/Casks/`](./homebrew/Casks/) | `scripts/release/publish-homebrew-cask.sh` |
| Scoop bucket | [`scoop/`](./scoop/) | `scripts/release/publish-scoop*.sh` |
| Winget (microsoft/winget-pkgs) | [`winget/`](./winget/) | `publish.yml` Winget jobs |
| Arch AUR | [`aur/`](./aur/) | `publish.yml` AUR jobs |

The publish jobs intentionally wait for release assets and their
`.sha256` sidecars before updating downstream registries. If a registry
submission is rerun manually, use the same rule: do not submit metadata
until the asset URL is live and the checksum matches the served bytes.

## Platform-specific checks

These are the parts that need more than "URL + SHA256 changed":

| Target | Nuance | Validate with |
|---|---|---|
| npm | Publishing uses trusted publishing (OIDC) and needs no stored token — but a trusted publisher is configured per package on npmjs.com, and that settings page only exists once the package does. So the **first** publish of each of the six needs `NPM_TOKEN`; after that, configure all six on npmjs.com and delete the secret. | After the first release, check a package's settings page shows a GitHub Actions trusted publisher, then run the npm job again with the secret removed. |
| npm | Six packages go up per release and the launcher must go last, or someone can install a `netscli` whose binary was never published. The publish script enforces the order and skips anything already on the registry, so a re-run after a partial upload is safe. | `scripts/release/publish-npm.sh vX.Y.Z --build-only`, which downloads the real assets, stages all six and runs the launcher against the binary for the current machine without touching npm. |
| MCP bundles | The binary is inside the bundle, so there is one per platform, and `compatibility.platforms` cannot express an architecture — the two Linux bundles look identical to a client and are told apart only by filename. | `scripts/release/build-mcpb.sh vX.Y.Z <dir>`; unzip one and run `server/netscli serve`. Set `MCPB_CMD` to a locally installed `mcpb` where `npx` is unavailable. |
| Winget CLI | The CLI asset is a bare executable, so the manifest must stay `InstallerType: portable`. | Compare the generated PR against `winget/cli/<version>/`; `winget validate`; install from the PR manifest. |
| Winget GUI | The GUI asset is a WiX MSI under a separate package id, `fstubner.netscli.gui`. | `winget validate`; confirm `PackageVersion`, `ProductVersion`, and install/uninstall behavior. |
| Scoop CLI | The asset URL uses `#/netscli.exe` rename syntax and generates completions in `post_install`. | `scoop install`; `netscli --version`; `scoop update`; verify the completion file is written. |
| Scoop GUI | Scoop extracts the MSI (`msiexec /a`) rather than running it, so the app lands under `PFiles\NetsCLI\` and `extract_dir` lifts it to the top of the app directory. The shortcut must name `netscli-gui.exe`, the file actually in the package. The publish script sets both on every release, because it edits the bucket's manifest rather than copying this template. | `scoop install netscli-gui`; confirm "Creating shortcut for NetsCLI" with no "failed"; launch the shortcut; `scoop uninstall`. |
| Homebrew formula | This tap formula installs prebuilt CLI binaries, not a source build. | `brew audit --strict --online`; `brew install --formula`; `brew test netscli`. |
| Homebrew Cask | macOS users will see Gatekeeper friction unless the app is signed/notarized. | `brew audit --cask --strict`; install both Intel and Apple Silicon DMGs when available. |
| AUR CLI | Runtime ELF deps and generated completions/manpage must work on Arch. | `makepkg --printsrcinfo`; `makepkg -si`; `namcap`. |
| AUR GUI | The AppImage wrapper should also install a launcher and icon. | `makepkg -si`; confirm `/usr/share/applications/netscli-gui.desktop` launches. |

The desktop app updates itself from `latest.json`, which release.yml's
`updater-manifest` job attaches to every release after checking each update
file's signature against the public key compiled into the app. The update
files are the MSI, the AppImage and a macOS `.app.tar.gz` that sits beside the
`.dmg`. Their updater signatures travel between jobs as workflow artifacts
and never become release assets, because the sigstore sidecars already use
the `<asset>.sig` name.

Windows Authenticode signing is handled by release.yml's `sign-windows`
job, not by any manifest here: both `.exe` builds and the `.msi` are signed
with a Certum cloud certificate and timestamped before they become release
assets. See `scripts/release/sign-windows.sh`. The desktop app's own
executable is signed earlier, inside the Windows build, by
`scripts/release/sign-windows-pe.ps1` through Tauri's `signCommand`, because
it can only be signed before WiX packs it into the MSI;
`scripts/release/check-msi-signed.ps1` then unpacks the MSI and fails the
build if anything inside is unsigned.

macOS notarization is still open. The `.dmg` ships unsigned and users see
"unverified developer" on first launch.

## Release-day checklist

1. Publish the GitHub release for `vX.Y.Z`.
2. Confirm `release.yml` uploads the expected CLI binaries, GUI
   installers, `.sha256` sidecars, and sigstore `.sig`/`.pem` files.
3. Confirm `publish.yml` completes or rerun the individual downstream job
   after any transient registry failure.
4. Monitor registry feedback, especially Winget moderator comments and
   AUR package comments.
5. Run the platform-specific checks above for any target touched by the
   release.
