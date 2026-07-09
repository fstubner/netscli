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

Only the latest `0.x` release gets security fixes. The project is
pre-`1.0`, so older `0.x.y` releases aren't patched; the fix will
land in the next point release.

| Version | Supported |
|---------|-----------|
| 0.3.x   | yes       |
| < 0.3   | no        |

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
