# Scoop

## One-time setup: create the bucket repo

1. Create a new public GitHub repo named
   [`fstubner/scoop-bucket`](https://github.com/fstubner/scoop-bucket).
   Scoop finds buckets via `scoop bucket add <name> <url>`.
2. Copy `netscli.json` from this directory into the bucket repo root.
   Commit and push.

Users install with:

```powershell
scoop bucket add fstubner https://github.com/fstubner/scoop-bucket
scoop install netscli
```

## After each release

The manifest has `checkver` + `autoupdate` blocks, so if you install
Scoop's `sfsu` or run `scoop bucket status` regularly, it can update
itself — but manual is more reliable:

1. Update `version` in `netscli.json`.
2. Replace `VERSION_SHA256_WINDOWS_X86_64` with the SHA256 of
   `netscli-windows-x86_64.exe` from the new release.
3. Commit + push.

## Moving to extras later

Once the project has ~200 stars, the manifest can be submitted to
[ScoopInstaller/Extras](https://github.com/ScoopInstaller/Extras) so
users don't need to add the bucket — `scoop install netscli` works
after `scoop bucket add extras`.
