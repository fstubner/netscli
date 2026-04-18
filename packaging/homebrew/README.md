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

1. Update `Formula/netscli.rb` in the tap repo:
   - bump `version`
   - replace the four `VERSION_SHA256_*` values with the SHA256s from
     the new release's `.sha256` files
2. `brew install --build-from-source ./Formula/netscli.rb` to verify
   locally.
3. Commit + push to the tap.

## Moving to homebrew-core later

Once the project has ~1k stars and a stable release track record, the
formula can be submitted to
[Homebrew/homebrew-core](https://github.com/Homebrew/homebrew-core) so
users don't need to tap — `brew install netscli` just works. Formula
structure stays similar; the review is stricter.
