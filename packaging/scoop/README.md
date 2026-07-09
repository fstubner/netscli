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

`publish.yml` updates the bucket through `scripts/release/publish-scoop.sh`
and `scripts/release/publish-scoop-gui.sh`. Both scripts wait for the
release `.sha256` sidecar, parse the first field, and write the hash
directly into the live bucket manifest. The checked-in JSON files here
are reference snapshots.

Validation still needs a real Scoop install because the CLI and GUI use
different package mechanics:

```powershell
scoop bucket add fstubner https://github.com/fstubner/scoop-bucket
scoop install netscli
netscli --version
scoop update netscli

scoop install netscli-gui
scoop uninstall netscli-gui
```

For the CLI, confirm the `#/netscli.exe` rename works and the
PowerShell completion file is generated. For the GUI, confirm the MSI
installs cleanly and the `NetsCLI` shortcut launches.

## Moving to extras later

Once the project has ~200 stars, the manifest can be submitted to
[ScoopInstaller/Extras](https://github.com/ScoopInstaller/Extras) so
users don't need to add the bucket — `scoop install netscli` works
after `scoop bucket add extras`.
