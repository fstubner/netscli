# Arch User Repository (AUR)

## Packages

The AUR wants a git repo per package. The package namespace `netscli`
is unclaimed; we submit as `netscli-bin` (Arch convention for a
prebuilt-binary package; a `netscli` source package that compiles from
crates.io would be a separate submission).

The desktop app ships separately as `netscli-gui-bin` because the CLI/TUI/MCP
binary and the Tauri desktop AppImage have different runtime dependencies.

## First submission

```bash
# One-time: clone your AUR profile
git clone ssh://aur@aur.archlinux.org/netscli-bin.git
cd netscli-bin

# Copy the template PKGBUILD in, fill in real SHA256s from the release.
# Include sha256sums for LICENSE plus the architecture-specific assets.
cp /path/to/packaging/aur/PKGBUILD .

# Required: .SRCINFO derived from PKGBUILD
makepkg --printsrcinfo > .SRCINFO

# Sanity check the build
makepkg -si

# Submit
git add PKGBUILD .SRCINFO
git commit -m "Initial release: netscli-bin X.Y.Z"
git push origin master
```

## After each release

The normal path is `.github/workflows/publish.yml`: it waits for release
assets, reads the `.sha256` sidecars, computes the tagged LICENSE hash,
renders the checked-in PKGBUILD, and pushes to AUR over SSH.

If updating manually:

```bash
cd netscli-bin
# Edit PKGBUILD: bump pkgver, replace sha256sums and sha256sums_* values
makepkg --printsrcinfo > .SRCINFO
git commit -am "Update to X.Y.Z"
git push
```

AUR is entirely self-service — there's no review, and the moment you
push, the new version is live.

## Source-based package (future)

Once netscli is stable enough that its dep tree doesn't churn every
release, a `netscli` source PKGBUILD that builds from crates.io is
worth creating. It would avoid the `-bin` suffix and give Arch users
a properly compiled binary for their specific CPU.
