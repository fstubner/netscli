# Scoop

## One-time setup: create the bucket repo

1. Create a new public GitHub repo named
   [`fstubner/scoop-bucket`](https://github.com/fstubner/scoop-bucket).
   Scoop finds buckets via `scoop bucket add <name> <url>`.
2. Copy `netscli.json` and `netscli-gui.json` from this directory into a
   `bucket/` directory in the bucket repo. Commit and push.

   The path matters. This step used to say "the bucket repo root", which
   is a layout Scoop accepts but the automation does not: both publish
   scripts edit `bucket/netscli.json` and `bucket/netscli-gui.json` by
   name, so a manifest at the root leaves every release silently editing
   a file that is not there. The live bucket has always used `bucket/`.

Users install with:

```powershell
scoop bucket add fstubner https://github.com/fstubner/scoop-bucket
scoop install netscli
```

## After each release

`publish.yml` updates the bucket through `scripts/release/publish-scoop.sh`
and `scripts/release/publish-scoop-gui.sh`. Both call `verified_sha` from
`scripts/release/lib.sh`, which waits for the release `.sha256` sidecar,
downloads the asset itself, hashes those bytes, and aborts unless the two
agree — only then does the digest reach the live bucket manifest. The
checked-in JSON files here are reference snapshots.

This paragraph used to say the scripts parse the sidecar and write its
value straight through. That was true once and was the bug: sidecar and
asset come from the same origin, so trusting one to describe the other
can only ever catch corruption in transit. The parent
[`packaging/README.md`](../README.md) says the same.

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

`netscli-gui.json` has no `installer` block. Scoop extracts the `.msi`
like an archive rather than running it (its documentation calls the MSI
mechanism deprecated), which leaves the app at
`PFiles\NetsCLI\netscli-gui.exe`. So `extract_dir` lifts that folder to
the top of the app directory, and the `shortcuts` entry names
`netscli-gui.exe`, the file that is actually in the package.
`scripts/release/publish-scoop-gui.sh` sets both on every release,
because it edits the bucket's manifest rather than copying this one.

## Moving to extras later

Once the project has ~200 stars, the manifest can be submitted to
[ScoopInstaller/Extras](https://github.com/ScoopInstaller/Extras) so
users don't need to add the bucket — `scoop install netscli` works
after `scoop bucket add extras`.
