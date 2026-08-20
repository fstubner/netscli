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

## What has never been reviewed

There has been no security review of the supply chain. Specifically, none
of the following has been examined:

- `.github/workflows/` — including `publish.yml`, which holds tokens for
  crates.io, the Homebrew tap, the Scoop bucket, winget and AUR.
- `scripts/release/` — the publish scripts, which fetch release assets over
  the network and rewrite packaging manifests from what they download.
- `packaging/` — the manifests and installer templates.
- `apps/netscli-gui/src-tauri/wix/` and `nsis/` — the Windows installer
  templates.

This is stated because the gap has already produced a real issue. Until
2026-08-19 the MSI used Tauri's `downloadBootstrapper` default, which
fetched and executed an installer over the network at install time,
elevated, with no hash pinning. It was found by reading the bundle config,
not by any review.

Dependency scanning also has a blind spot worth naming: `npm audit
--omit=dev` excludes the build toolchain that produces the shipped bundle,
so a compromised bundler is not something the current checks would catch.

Packet capture on Windows is covered by no test at all. The
`--features pcap` test steps in `.github/workflows/ci.yml` are gated
`if: runner.os == 'Linux'`, and the feature cannot even be built on Windows
without the Npcap SDK installed — without it the link step fails with
`LNK1181: cannot open input file 'wpcap.lib'`. So the Npcap paths, which are
the reason the feature matters on Windows, are exercised by nothing anywhere.

If you are picking this up, treat those four areas as unaudited rather than
as reviewed and clean.

## Dependencies

The project uses Dependabot for automated dependency updates. Alerts
are visible at
https://github.com/fstubner/netscli/security/dependabot
(public-visible; advisory severity is GitHub's classification).
