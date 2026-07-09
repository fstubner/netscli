# Packaging

Manifest templates, generated package metadata, and submission notes for
getting NetsCLI into the major OS package managers.

Most live package-manager updates are automated from
`.github/workflows/publish.yml` after a GitHub release is published. The
files in this directory are reference templates/snapshots and should stay
accurate enough to review, but the publish jobs compute release SHA256s
from the uploaded `.sha256` sidecars before pushing downstream updates.

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
| Winget CLI | The CLI asset is a bare executable, so the manifest must stay `InstallerType: portable`. | Compare the generated PR against `winget/cli/<version>/`; `winget validate`; install from the PR manifest. |
| Winget GUI | The GUI asset is a WiX MSI under a separate package id, `fstubner.netscli.gui`. | `winget validate`; confirm `PackageVersion`, `ProductVersion`, and install/uninstall behavior. |
| Scoop CLI | The asset URL uses `#/netscli.exe` rename syntax and generates completions in `post_install`. | `scoop install`; `netscli --version`; `scoop update`; verify the completion file is written. |
| Scoop GUI | MSI install plus shortcut behavior is Scoop-specific. | `scoop install netscli-gui`; launch shortcut; `scoop uninstall`. |
| Homebrew formula | This tap formula installs prebuilt CLI binaries, not a source build. | `brew audit --strict --online`; `brew install --formula`; `brew test netscli`. |
| Homebrew Cask | macOS users will see Gatekeeper friction unless the app is signed/notarized. | `brew audit --cask --strict`; install both Intel and Apple Silicon DMGs when available. |
| AUR CLI | Runtime ELF deps and generated completions/manpage must work on Arch. | `makepkg --printsrcinfo`; `makepkg -si`; `namcap`. |
| AUR GUI | The AppImage wrapper should also install a launcher and icon. | `makepkg -si`; confirm `/usr/share/applications/netscli-gui.desktop` launches. |

Windows Authenticode signing and macOS notarization are not solved by
the package-manager manifests. They are separate release-trust work, and
should be tracked before pushing for broader public distribution.

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
