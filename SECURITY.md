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

## Dependencies

The project uses Dependabot for automated dependency updates. Alerts
are visible at
https://github.com/fstubner/netscli/security/dependabot
(public-visible; advisory severity is GitHub's classification).
