# Homebrew

## One-time setup: create the tap repo

1. Create a new public GitHub repo named
   [`fstubner/homebrew-tap`](https://github.com/fstubner/homebrew-tap).
   Homebrew finds taps by the `homebrew-` prefix.
2. Copy `netscli.rb` from this directory into `Formula/netscli.rb` in
   that repo. Commit and push.

Users install with:

```bash
brew tap fstubner/tap
brew install netscli
```

## After each release

`publish.yml` updates the tap through `scripts/release/publish-homebrew.sh`
and `scripts/release/publish-homebrew-cask.sh`. The CLI formula installs
prebuilt binaries from the GitHub release; it is not a source-build
formula.

Validate the pushed tap with:

```bash
brew audit --strict --online fstubner/tap/netscli
brew install fstubner/tap/netscli
brew test fstubner/tap/netscli

brew audit --cask --strict fstubner/tap/netscli
brew install --cask fstubner/tap/netscli
```

The Cask installs DMGs for the desktop app. macOS signing and
notarization are separate release-trust work; the Cask can point at an
unsigned DMG, but users may see Gatekeeper friction.

## Moving to homebrew-core later

Once the project has ~1k stars and a stable release track record, the
formula can be submitted to
[Homebrew/homebrew-core](https://github.com/Homebrew/homebrew-core) so
users don't need to tap — `brew install netscli` just works. Formula
structure stays similar; the review is stricter.
