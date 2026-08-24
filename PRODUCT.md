# NetsCLI — product contract

Written from what the repository already evidences (README, `docs/`, the
site copy, and the shipped interfaces), with the user ordering and success
criteria supplied by the maintainer. Claims that are **inferred** rather
than stated somewhere in the repo are marked `[inferred]` so they are easy
to correct rather than easy to mistake for settled.

## Purpose

Answer questions about a local network — what is on it, what is reachable,
what is listening — and return the answer as structured data rather than
text a human has to read and re-type.

The origin, from the README, was narrower: driving those questions from an
AI agent, which existing tools make awkward ("half a dozen CLI invocations,
brittle output parsing, no shared context"). The MCP server was built
first, then the TUI, CLI, and desktop app, all over one Rust core
(`netscli-core`).

**A tension worth recording.** The README and the website both lead with
the agent/MCP story, but the maintainer ranks agent-driven users *last* of
four (see Users). The code's history explains the emphasis; the priorities
below are what the product is actually for now. Where the two disagree,
this document is the current intent and the README is the origin story.

## Users

In priority order, as stated by the maintainer:

1. **Specialists** — people whose job includes networks, who know what an
   ARP table is and will notice when a tool lies about one.
2. **Operations** — people running or supporting infrastructure, who need a
   quick, trustworthy answer during work that is not primarily about
   networking.
3. **Anyone on a home or office LAN** — non-specialists who mostly want to
   see what is connected. `[inferred]` This is the group the desktop app
   serves most directly; the CLI and TUI assume more.
4. **Agent-driven developers** — wiring `netscli serve` into an MCP client
   so an agent can answer network questions without parsing CLI output.

The ordering matters for conflicts: when a change would make the desktop
app friendlier at the cost of a specialist's accuracy, the specialist wins.

## Success

All four of the following, as stated by the maintainer:

- **Agents answer network questions unaided.** An MCP client resolves a
  real question — "what just joined the network", "is port 22 open on
  192.168.1.42" — in one exchange, without correction.
- **Downloads and installs grow.** Adoption through GitHub releases and the
  package managers is a signal that it is useful beyond one machine.
- **It is the tool the maintainer personally reaches for**, in place of
  whatever came before.
- **No wrong answers.** The scanner never silently reports something false.

The last one is not decoration. The 0.3.1 release exists because three
separate faults *reported success while doing nothing*: ping claimed total
loss against the host's own address, a fresh install ran one probe at a
time while appearing configured for 256, and `arp --clear` printed "ARP
table cleared" after clearing nothing. A wrong answer delivered
confidently is the failure mode this product most has to avoid, because
every surface above the core inherits it.

## MVP

Already shipped and in the released product:

- One core library (`netscli-core`) with scan, ping, traceroute, discover,
  sweep, DNS/reverse/mDNS, ARP, and interface enumeration.
- Four interfaces over it: CLI (`netscli`), terminal UI, desktop app
  (Tauri), and MCP server (`netscli serve`, nine tools by default).
- Structured output — `--json` on the CLI, typed results across the MCP
  boundary — as the primary contract, with human-readable text as a view
  of it rather than the source of truth.
- Cross-platform binaries and installers for Linux, macOS, and Windows.

Out of scope for the current line `[inferred, from what the code does not
attempt]`: exploitation or intrusion of any kind, credentialed access to
discovered hosts, and continuous monitoring. The tools answer questions at
a moment in time.

## Constraints

- **Rust 1.96**, one workspace, crates versioned together but not
  inheriting a workspace version — each manifest carries its own, and a
  release has to touch all of them plus `package.json` and
  `tauri.conf.json`. See `docs/PUBLISHING.md`.
- **Privilege boundaries are real and platform-specific.** Raw ICMP needs
  administrator rights on Windows; clearing the ARP table needs them
  everywhere. Where a capability is unavailable the product must say so and
  fail, not degrade quietly into a different answer.
- **The MCP surface is a trust boundary.** `server/targets.rs` restricts
  what an agent may scan and `server/limits.rs` caps what a scanned host can
  put into a model's context. Both exist so a prompt-injected model cannot
  point the scanner at strangers, and neither may be relaxed for
  convenience.
- **crates.io publication is irreversible** — a version number, once used,
  is spent whether or not the release was any good.
- Network safety limits (concurrency caps, target policy) are deliberate
  and are not to be widened to make something faster.
