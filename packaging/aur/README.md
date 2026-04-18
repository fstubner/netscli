# Arch User Repository (AUR)

## First submission

The AUR wants a git repo per package. The package namespace `netscli`
is unclaimed; we submit as `netscli-bin` (Arch convention for a
prebuilt-binary package; a `netscli` source package that compiles from
crates.io would be a separate submission).

```bash
# One-time: clone your AUR profile
git clone ssh://aur@aur.archlinux.org/netscli-bin.git
cd netscli-bin

# Copy the template PKGBUILD in, fill in real SHA256s from the release
cp /path/to/packaging/aur/PKGBUILD .

# Required: .SRCINFO derived from PKGBUILD
makepkg --printsrcinfo > .SRCINFO

# Sanity check the build
makepkg -si

# Submit
git add PKGBUILD .SRCINFO
git commit -m "Initial release: netscli-bin 0.1.1"
git push origin master
```

## After each release

```bash
cd netscli-bin
# Edit PKGBUILD: bump pkgver, replace the two sha256sums_* values
makepkg --printsrcinfo > .SRCINFO
git commit -am "Update to 0.1.2"
git push
```

AUR is entirely self-service — there's no review, and the moment you
push, the new version is live.

## Source-based package (future)

Once netscli is stable enough that its dep tree doesn't churn every
release, a `netscli` source PKGBUILD that builds from crates.io is
worth creating. It would avoid the `-bin` suffix and give Arch users
a properly compiled binary for their specific CPU.
