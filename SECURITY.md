# Security Policy

## Reporting a vulnerability

If you find a security issue, **please do not open a public GitHub
issue**. Use GitHub's private vulnerability reporting instead:

https://github.com/fstubner/netscli/security/advisories/new

I'll acknowledge within a few days, discuss a fix, and coordinate a
release and disclosure timeline with you.

If private vulnerability reporting isn't available to you for some
reason, email `felix.stubner@gmail.com` with `[netscli security]` in
the subject. Plain text is fine.

## Supported versions

Only the **latest published release** gets security fixes. The project
is pre-`1.0`, so older releases aren't patched; the fix lands in the
next point release.

"Latest published" means the newest tag on
https://github.com/fstubner/netscli/releases — not whatever version
number happens to be in the source tree, which may be ahead of what has
actually shipped.

This is deliberately phrased as a rule rather than a table of version
numbers: a hardcoded table goes stale the moment a release is cut or
deferred, and a stale table can tell users their supported version is
unsupported.

## Scope

In scope:
- `netscli-core`, `netscli-mcp`, `netscli`, `netscli-gui` crates.
- The release binary installers (`scripts/install.sh`,
  `scripts/install.ps1`).
- The MCP server's JSON-RPC surface exposed by `netscli serve`.

Out of scope:
- Advisories against transitive dependencies that are not reachable
  given our feature flags (for example, PostgreSQL-protocol CVEs in
  `sqlx` while we enable only the `sqlite` feature). These are
  tracked via Dependabot and upgraded as a hygiene pass, not as
  security responses.
- Issues that require root or administrator access to exploit, when
  that access already grants equivalent capability without netscli.

## How far the supply chain has been reviewed

This section used to say the supply chain had never been reviewed at all,
and listed four areas as unexamined. Three of them have since had work, so
the list was telling readers to distrust things that had been fixed. What
follows is where each actually stands. **"Read" is not "adversarially
reviewed" — nobody has attacked any of this.**

- `.github/workflows/` — **read, and hardened.** `publish.yml` holds the
  tokens for crates.io, the Homebrew tap, the Scoop bucket, winget and AUR.
  It now validates the tag before it reaches a `sed` expression (a
  `workflow_dispatch` input previously flowed straight into one, in a job
  holding an SSH key), and re-hashes every downloaded asset instead of
  trusting the `.sha256` published beside it.
- `scripts/release/` — **read, and hardened.** The same checksum logic lives
  in `lib.sh` as `verified_sha`, which downloads the asset, hashes the bytes,
  and refuses to continue unless the sidecar agrees. `lib_test.sh` pins that
  behaviour along with the tag-validation cases, including shell-metacharacter
  rejection.
- `packaging/` — **read.** Manifests and templates checked against the
  release assets they name. Digests in the checked-in templates are `@@…@@`
  placeholders rather than real-looking values, so a failed substitution
  cannot ship a stale hash, and the AUR render step greps for leftovers
  before pushing to a registry that has no review step.
- `apps/netscli-gui/src-tauri/wix/` and `nsis/` — **read, nothing found.**
  The NSIS hook only deletes its own registry keys on uninstall. `main.wxs`
  is Tauri's stock template; its one custom action launches the installed
  app under `Impersonate="yes"`, so it runs as the invoking user rather than
  elevated.

The original warning existed because the gap had already produced a real
issue, and that is worth keeping: until 2026-08-19 the MSI used Tauri's
`downloadBootstrapper` default, which fetched and executed an installer over
the network at install time, elevated, with no hash pinning. It was found by
reading the bundle config, not by any review. It is now `embedBootstrapper`.

## What is still not covered

- **No adversarial review of anything above.** Everything in that list has
  been read for correctness and obvious injection paths. None of it has been
  attacked by someone trying to get code into a release.
- **No fuzzing.** Neither the packet parser nor the MCP JSON-RPC surface has
  been fuzzed, and both parse input the operator did not write.
- **Packet capture on Windows is compiled, never executed.** CI now installs
  the Npcap SDK on the Windows runner and builds the `--features pcap` test
  targets there, so a Windows-only break in the Npcap paths fails the build
  rather than reaching a release. Nothing runs them: the test binary imports
  `wpcap.dll`, which ships with the Npcap runtime driver rather than the SDK,
  and without it Windows refuses to load the executable at all
  (`STATUS_DLL_NOT_FOUND`). Installing a capture driver in CI to run unit
  tests is a worse trade than leaving this gap named. Every Windows capture
  path is therefore verified by compilation only, and by manual testing.
- **No dependency licence audit.** There is no `cargo deny` or equivalent in
  the repository.

## Dependencies

Two scanners run in `.github/workflows/audit.yml`, weekly and on every
change to a lockfile or manifest:

- `cargo audit` over the Rust tree.
- `npm audit` over `site/` and `apps/netscli-gui/`, deliberately **not**
  `--omit=dev`: the build toolchain is what produces the bundle users
  install, so excluding it would leave a compromised bundler unscanned.
  The job fails on `high` and above. The moderates below that threshold are
  still printed; the ones open today are an `adm-zip` chain reached through
  the accessibility test runner, whose only offered fix is a major downgrade
  of that runner.

Dependabot runs alongside these, and the two are not redundant. On
2026-09-09 `npm audit` reported a high-severity `js-yaml` advisory and three
moderates that Dependabot had never raised, while Dependabot was reporting
six it grouped differently. Alerts are at
https://github.com/fstubner/netscli/security/dependabot
(public-visible; advisory severity is GitHub's classification).
