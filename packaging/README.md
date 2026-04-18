# Packaging

Manifest templates and submission notes for getting netscli into the
major OS package managers.

Each subdirectory is a template that points at a specific release tag.
After cutting a new release, update the version + SHA256 values and
submit a PR to the respective registry.

## How the release pipeline feeds these

Every push of a `v*` tag triggers `.github/workflows/release.yml`,
which for each platform:

1. Builds the binary with `cargo build --release --locked`.
2. Writes a `.sha256` alongside it.
3. Signs it via [sigstore keyless](https://docs.sigstore.dev/cosign/signing/overview/)
   using the GitHub Actions OIDC token, producing `.sig` + `.pem`.
4. Uploads all four files as release assets.

Package manifests reference the `.tar.gz`/`.zip`/`.exe` URL plus the
SHA256. The `.sig` + `.pem` let security-conscious users verify
provenance without trusting GitHub's binary storage:

```bash
cosign verify-blob \
  --certificate netscli-linux-x86_64.pem \
  --signature   netscli-linux-x86_64.sig \
  --certificate-identity-regexp 'https://github.com/fstubner/netscli/.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  netscli-linux-x86_64
```

## Submission targets

| Registry | Dir | Status |
|---|---|---|
| Homebrew (tap) | [`homebrew/`](./homebrew/) | not submitted |
| Scoop bucket | [`scoop/`](./scoop/) | not submitted |
| Winget (microsoft/winget-pkgs) | [`winget/`](./winget/) | not submitted |
| Arch AUR | [`aur/`](./aur/) | not submitted |

Each directory has its own README with the exact submission steps. The
submission PRs should be filed **after** the corresponding release is
published and the assets (including `.sha256`) are live on the release
page — the registries refuse PRs whose URLs 404 or whose checksums
don't match the served bytes.

## Release-day checklist

1. Cut a crates.io release (see [`../docs/PUBLISHING.md`](../docs/PUBLISHING.md)).
2. Tag `vX.Y.Z` and push. Release workflow builds + signs + uploads all
   assets.
3. Verify release page has the full asset matrix (22 files: 11 binaries
   × `.sha256`/`.sig`/`.pem`).
4. Run `./update-manifests.sh vX.Y.Z` (planned) to pull the real SHA256s
   and stamp them into each template.
5. Open the four PRs, one per registry.
6. Monitor for lint/review feedback; most registries have maintainer
   review latency in the hours-to-days range.
