# xtctx

[![CI](https://github.com/fstubner/xtctx/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fstubner/xtctx/actions/workflows/ci.yml)
[![Landing Deploy](https://github.com/fstubner/xtctx/actions/workflows/deploy-landing.yml/badge.svg?branch=main)](https://github.com/fstubner/xtctx/actions/workflows/deploy-landing.yml)
[![Release](https://github.com/fstubner/xtctx/actions/workflows/release.yml/badge.svg)](https://github.com/fstubner/xtctx/actions/workflows/release.yml)
[![npm Publish](https://github.com/fstubner/xtctx/actions/workflows/publish.yml/badge.svg)](https://github.com/fstubner/xtctx/actions/workflows/publish.yml)
[![Latest Release](https://img.shields.io/github/v/release/fstubner/xtctx?display_name=tag&sort=semver)](https://github.com/fstubner/xtctx/releases)
[![License](https://img.shields.io/github/license/fstubner/xtctx)](LICENSE)
[![Node >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

xtctx is local cross-tool handoff for AI coding agents.

It indexes the transcript files your local coding agents already write, and
exposes them over MCP so the next tool you open can find recent sessions and
read the raw messages. It does not run a daemon, host an API, generate
summaries, or maintain durable project memory.

Each project opts in once with `xtctx setup`. The MCP server resolves the
project from the working directory, and in a project that has not opted in it
says so and names the command, so an agent can offer it. Setup does not push
the transcripts themselves to the agent: in Claude Code a SessionStart hook
injects a short pointer to recent sessions, and every other tool gets
instruction text that names the tools to call.

The intended user is a solo developer who switches between local coding agents
and wants the next agent to recover recent context without a pasted recap.

## Install

Two routes, and they answer different questions.

The **plugin** is the smaller commitment: it registers the MCP server and the
handoff skill machine-wide, and writes nothing into your project. The tools
resolve the project from the working directory. In a project that has been
set up they answer; in one that has not, every tool says so and names
`xtctx setup`, so the agent can offer it — nothing is scanned or written
into a directory nobody opted in. What you are relying on is the agent
choosing to call a tool, which the skill prompts it to do.

**`setup`** writes managed blocks into the instruction files each tool already
reads (`CLAUDE.md`, `AGENTS.md`, Cursor rules, and so on); they tell the agent
that xtctx exists and which tools to call, and the agent still has to call
them. For Claude Code it also installs a SessionStart hook that injects a
short pointer to recent sessions at the start of each session. It wires MCP
per tool and translates the skill into each tool's native format.

| | Plugin | `setup` |
|---|---|---|
| MCP tools | yes | yes |
| Handoff skill | yes | yes |
| Reachable from every project | yes | no |
| Retrieval in an unconfigured project | no (offers `setup`) | no |
| Pointer to recent sessions injected at session start | no | Claude Code only |
| Instruction text naming the tools | no | yes |
| SessionStart hook (Claude Code) | no | yes |
| Writes into your project | no | yes |
| Tool coverage | six with a plugin format | every supported tool |

Start with the plugin so the tools are reachable everywhere, then run `setup`
in each project you want handoff in; the two compose, and running both is the
normal end state.

```bash
npx -y xtctx setup
```

As a plugin, from the marketplace this repository publishes:

```bash
claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx
```

```bash
codex plugin marketplace add fstubner/xtctx && codex plugin add xtctx@xtctx
```

```bash
copilot plugin marketplace add fstubner/xtctx && copilot plugin install xtctx@xtctx
```

```bash
agy plugin install https://github.com/fstubner/xtctx
```

Cursor registers the marketplace from its agent CLI, then installs from
`/plugins` in an interactive session:

```bash
cursor-agent plugin marketplace add https://github.com/fstubner/xtctx
```

VS Code reads the same package but has no CLI route: its plugin management
lives in the Chat view, behind the `chat.plugins.enabled` setting. opencode
has its own plugin system — JavaScript modules under `.opencode/plugins/`, or
npm packages named in `opencode.json` — but does not implement the Agent
Plugins standard the package above is built against, so `setup` is the only
route there.

Either route registers the same MCP server and the same handoff skill. The
plugin runs `npx -y xtctx`; `setup` writes `npx -y xtctx@<version>`, pinned
to the xtctx that ran it, and re-running setup is what moves the pin.

One thing to know about the plugin specifically: it is installed from this
repository, so its skill text comes from `main`, while the server it launches
is whatever `npx -y xtctx` resolves to on npm. Those are not the same commit
whenever work has landed but not been released — which is the normal state
here — so a plugin install can describe behaviour the server it runs does not
have yet. `xtctx status` reports a skill copy that predates the built-in one;
it cannot see the server's version from the other side. Because the plugin writes no project config, `xtctx status`
reports a plugin-only project as `Config missing (run xtctx setup)`, and the
tools answer the same way until `setup` has been run there.

### Semantic search is an optional add-on

The default install is small (about 55 MB on disk with its dependencies) and
searches by keyword straight away, with no model to download. Semantic search,
which also matches by meaning, needs a local embedding model, and the model
and its runtime are several hundred megabytes. They are not part of
`npx -y xtctx`: bundling them made a cold start take from 18 seconds to over
two minutes before the server could answer, which is longer than some MCP
clients wait.

Turn it on once per machine:

```bash
npx -y xtctx embeddings enable        # asks first; add --yes in a script or from an agent
```

That installs a pinned runtime from a lockfile shipped with this release into
`~/.xtctx/embeddings` (about 540 MB on disk, including the model), then the
server builds vectors in the background as before. `xtctx embeddings disable`
removes it again and leaves your index, vectors included, alone.
`xtctx status` says which mode you are in and how to switch.

Pointing a project at an OpenAI-compatible endpoint (see
[`docs/embedding-providers.md`](docs/embedding-providers.md)) needs none of
this: nothing local is installed for it.

One thing to expect in a project with a large transcript history: the first
scan builds the index from scratch and can run for minutes. The server starts
it as soon as it starts, calls return within a refresh budget with whatever
has landed so far, and each answer names the tools it has not read yet, so
the counts fill in over the first few calls rather than all at once.

## Workflow

```bash
npx -y xtctx setup
npx -y xtctx status
npx -y xtctx export
npx -y xtctx disconnect antigravity
```

`xtctx setup` writes project-level MCP config with `npx -y xtctx@<version>`
(the version that ran setup; `xtctx status` shows it on its `Pinned` line), installs
real hooks where a tool supports them, and writes managed instruction blocks
that point agents to the MCP retrieval tools. It also syncs selected project
skills from `.xtctx/skills` into verified native or adapter surfaces for
supported tools. Antigravity MCP is always written to the app-level config
because Antigravity has no project MCP file. Use `xtctx setup --global-mcp`
to also configure the global-only GitHub Copilot CLI surface.

`xtctx status` reports actual handoff state: config, MCP command, local SQLite
index, detected transcript stores, hook mode, managed-block drift, and stale
generated references. It also reports selected skills, generated skill targets,
target drift, and tools that do not have a verified skill surface.
It reports the current local index rather than forcing a transcript scan. If
the index is empty, ask a configured agent to call `xtctx_recent_sessions`.
When the index holds sessions whose transcripts are gone, it says how many and
points at `xtctx export`.

`xtctx disconnect <tool>` stops xtctx from managing one tool for the project.
It removes the xtctx MCP entry for that tool, removes managed instruction
blocks where that tool owns them, removes supported startup hooks, and marks the
tool disabled in `.xtctx/config.yaml`. It removes generated skill adapters for
that tool. It does not delete transcript sources, canonical project skills, or
the local SQLite index. Use `xtctx disconnect --all` to remove xtctx from every
supported tool — that one also deletes `.xtctx/skills`, since with nothing left
managing skills the synced source is xtctx's own scaffolding. A skill you
wrote yourself and selected at setup is kept where you wrote it. Antigravity and Copilot CLI keep one MCP config for every
project on the machine, so a project disconnect leaves those two files alone;
pass `--global-mcp` to remove xtctx from them as well.

That flag is **not** symmetric with `setup`, and the difference is worth
knowing before you assume `disconnect --all` has removed everything. `setup`
writes Antigravity's config without the flag, because Antigravity has no
project-scoped MCP file and there is nowhere else to put it; `setup
--global-mcp` additionally writes Copilot CLI's. Neither file holds a
per-project entry, so a project disconnect cannot remove "this project's"
wiring from them — it can only remove xtctx from that client for every project
at once. Doing that silently is exactly what it used to do, and it took xtctx
away from every other project on the machine, so it is an explicit step now.

To remove xtctx from a machine entirely: `xtctx disconnect --all --global-mcp`
in each project you set up, then delete each project's `.xtctx` directory,
which holds the config and the indexed transcripts and is deliberately kept.
Run `xtctx export` first if you want to keep the sessions whose transcripts
are already gone: the index is their only copy.

`xtctx export` writes this project's indexed sessions and messages to a JSON
Lines file (`xtctx-export-<time>.jsonl` in the current directory, or
`--out <file>`; `--out -` for stdout). It reads the index as it stands, never
touches a transcript, and never overwrites an existing file. `xtctx import
<file>` merges an export back into a project's index — after the index was
deleted, on another machine, or into a project that has moved. Sessions keep
their ids, so importing the same file twice, or into an index that already
has some of its sessions, adds only what is missing. Retrieval windows are
rebuilt on import and vectors re-embedded as usual; the file holds sessions
and messages only. The export holds raw conversation text, so treat it like
the index: keep it, and do not commit it.

`xtctx scan` reads every enabled transcript store into the project's index and
exits. The MCP server does the same thing on its own every time it starts, so
the session after another tool's work starts with that work already indexed.
The scan is incremental and runs in the background: it resumes from a
per-file offset, so after the first pass it reads only what each tool has
appended. The first pass over a large history is the expensive one — see the
note above.

`xtctx scan --embed` additionally vectorizes every window the scan leaves
without one, running to completion however long that takes rather than to a
budget. It needs semantic search to be enabled (`xtctx embeddings enable`) and
says so when it is not. You need it when `xtctx status` says the backlog is
too large to finish in the background — otherwise the server gets there on its
own.

Once semantic search is enabled, indexing picks a device by measuring it, and
**you do not have to do anything to get that**. The first time the MCP server
starts on a machine, or the first `xtctx scan --embed`, it times the embedding
model on each execution provider available and remembers
the fastest in `~/.xtctx/device.json`, once per machine. On a machine with a
usable GPU that has measured roughly six times faster than the CPU; on one
without, it picks the CPU and nothing changes. Vectors are identical whichever
device wins, so this changes speed and nothing else.

Nothing is measured while semantic search is off, since there is no model to
time. `xtctx calibrate` runs that measurement on demand and prints it. You need it
only to re-measure after the hardware changes (`--force`) or to see the
numbers — it is not a setup step. `scan --no-calibrate` skips the automatic
run for anyone who would rather start embedding immediately.

Generated MCP clients should use:

```json
{
  "mcpServers": {
    "xtctx": {
      "command": "npx",
      "args": ["-y", "xtctx@<version>"]
    }
  }
}
```

When invoked by an MCP client over stdio, bare `xtctx` starts the MCP server.
When invoked in a normal terminal, it shows the human CLI.

## MCP Tools

- `xtctx_recent_sessions` lists recent indexed transcript sessions.
- `xtctx_session_detail` returns raw messages for a `session_ref`.
- `xtctx_search_sessions` hybrid-searches chronological transcript windows: keyword always, plus local semantic vectors once semantic search is enabled (`xtctx embeddings enable`). `mode: "literal"` skips the index entirely and matches text straight in the transcript stores, so it answers before a scan has finished and finds exact strings the index has not reached yet; it reads what the scrapers attribute to this project, so it never widens the project boundary. It says when it stopped at its limit or time budget rather than reporting an empty result as a complete one.
- `xtctx_continuity_status` reports wiring and local index diagnostics.
- `xtctx_handoff_manifest` returns a read-only orchestrator envelope with stable
  session handoff IDs and pointers to raw-detail retrieval. A caller can attach
  a correlation ID; xtctx echoes it but does not persist task state.

The server scans transcript stores when it starts and on each call, updating
`.xtctx/state/xtctx.db` as it goes. The source transcripts remain
authoritative while they exist, and for those sessions the index is derived
data. It is also the only copy of sessions whose transcripts have since been
deleted (Claude Code deletes them after 30 days by default), so deleting it
loses those. xtctx never deletes it: an upgrade migrates it in place, and a
corrupt one is moved aside, rebuilt, and has those sessions copied back in.
Keep it, back it up with `xtctx export`, and do not commit it: it holds raw
conversation text.

With the plugin installed, a project that has also run `setup` reaches the
same server under two names in Claude Code (`xtctx` from `.mcp.json` and
`plugin:xtctx:xtctx` from the plugin). Setup grants the tools under both, so
whichever copy the agent picks needs no prompt.

When semantic search is enabled it embeds sliding windows of raw transcript
turns, not generated summaries. Window text includes role, timestamp, and message order so retrieval
can prefer the relevant point in the conversation, then return the matching
message range for `xtctx_session_detail`.

## Supported Tools

- Claude Code
- Cursor
- Codex
- GitHub Copilot
- Google Antigravity
- opencode
- GitHub Copilot CLI

Each tool has a scraper for local handoff storage. Antigravity support reads
full transcript steps from the running local Antigravity language server when
it is available, and falls back to readable `brain` artifacts when the encrypted
`.pb` conversation store cannot be queried. Setup writes Antigravity MCP config
and a managed `GEMINI.md` handoff block (Antigravity CLI keeps project-memory
compatibility with that file). Some tools have native MCP config or executable
startup hooks; others receive MCP config plus managed instructions only.
`xtctx status` labels the real mode for each integration.

## Limits

- xtctx is local-only by default: it never uploads transcripts and runs no
  telemetry. A project can opt into an external embedding endpoint by writing
  one into `.xtctx/config.yaml`, in which case window text is sent there to be
  vectorized — never inferred from an environment variable, and `xtctx status`
  names the endpoint in full whenever one is configured.
- Transcript formats belong to each upstream tool and can drift. The drift
  tests and format fingerprints exist to catch parser breakage, but `xtctx status`
  is still the source of truth for your machine.
- Semantic search is off until you run `xtctx embeddings enable`; until then
  every search is keyword-only, which `xtctx status` states along with the
  command. Vectors are built incrementally once it is on, and the MCP server
  also works the backlog down in the background when it starts, as long as
  this machine's measured rate says the remainder fits in fifteen minutes.
  Above that nothing drains it on its own and `xtctx status` says so, naming
  `xtctx scan --embed`. Hybrid search falls back to keyword whenever vectors
  are missing or the embedding model is unavailable, and `xtctx status`
  reports the reason. An index that already has vectors from an earlier
  install keeps them while the add-on is off.
- Antigravity conversation `.pb` files are not parsed directly; retrieval uses
  the local language-server API when available, otherwise readable `brain`
  artifacts.

## Skill Sync

Project skills live in `.xtctx/skills/<skill-id>/SKILL.md`. Fresh setup writes
the built-in `xtctx-handoff` skill. Interactive setup also inventories skills
from connected tool surfaces and lets you select which ones to keep in sync for
the project. Non-interactive `xtctx setup --yes` is conservative: it syncs the
built-in skill plus any skills already selected in `.xtctx/config.yaml`.

Skill sync uses real target surfaces only:

- Claude Code receives native project skills under `.claude/skills/`.
- Cursor receives generated rule adapters under `.cursor/rules/xtctx-skills/`.
- GitHub Copilot receives generated instruction adapters under `.github/instructions/`.
- Antigravity, Codex, opencode, and Copilot CLI receive skill pointers through
  managed handoff blocks (`GEMINI.md` / `AGENTS.md` / Copilot instructions).
- Tools without a verified native or adapter surface are reported as unsupported.

## Project Files

- `.xtctx/config.yaml`: project xtctx configuration
- `.xtctx/skills/<skill-id>/SKILL.md`: canonical local project skills
- `.xtctx/state/xtctx.db`: local handoff index, the only copy of sessions whose transcripts are gone; back up with `xtctx export`, never commit
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/xtctx.mdc`, `.github/copilot-instructions.md`: managed handoff instructions where applicable

Content outside `<!-- xtctx:begin -->` / `<!-- xtctx:end -->` fences is
preserved. Run `xtctx setup --yes` again to replace stale or duplicated generated
blocks.

## Development

```bash
npm ci
npm --prefix landing ci
npm run verify:release
```

Useful focused checks:

```bash
npm test
npm run test:drift
npm run lint
npm run build
npm run demo:public
```

`npm test` excludes the smoke, drift and eval suites, which build, spawn
processes and load a real embedding model. What each suite defends, what it
structurally cannot catch, and how that was measured is in
[`docs/testing-strategy.md`](docs/testing-strategy.md).

Indexing throughput — what has been measured, what was tried and rejected, and
what is still open — is in
[`docs/embedding-performance.md`](docs/embedding-performance.md). Read it
before optimizing the embedding path; several of the obvious ideas have
already been measured and lost.

`npm run demo:public` creates synthetic Claude Code and Codex transcript stores
in a temporary project, starts the built MCP server, and calls the public
handoff tools. It does not scan private local transcript directories. See
[`docs/demo.md`](docs/demo.md).

## Orchestrator Integration

xtctx is supporting fabric, not an orchestrator. An external control plane can
call `xtctx_handoff_manifest` to obtain project-scoped handoff IDs and the
corresponding `xtctx_session_detail` calls, then retain its own task, branch,
ownership, and scheduling state. See
[`docs/orchestrator-integration.md`](docs/orchestrator-integration.md).

## Release

Nothing is released by merging. Cutting a release is one manual action: run the
**release** workflow, choose `patch`/`minor`/`major`, and type `release` to
confirm. It runs `verify:release` first, then bumps the version, writes the
CHANGELOG entry from GitHub's generated notes, commits, tags, creates the
GitHub release, and publishes to npm.

Untick `publish_npm` to cut a release without publishing. To publish a version
that was tagged earlier, run the **publish** workflow on its own against that
tag — it verifies the checked-out commit really carries the tag for the version
in `package.json`, so a branch tip cannot be published by mistake.

This replaced an automatic pipeline. Every `fix:`/`feat:` merge opened a release
PR that a second workflow auto-merged within seconds, so merging any change at
all cut a release: five versions went out between 09:34 and 16:58 on
2026-08-30, none awaited, none soaked. A per-day ceiling was tried first and was
the wrong shape — capping unwanted releases still leaves them unwanted.

Releases are published rather than drafted, deliberately, and `publish.yml` has
no `release: published` trigger. It had one once, with releases drafted so
nothing published itself, and that broke outright: GitHub's `releases/latest`
endpoint hides drafts, the release tooling read that endpoint to find the last
release, so it saw a pre-draft version forever and proposed a release covering
the entire history. It cut 76 versions over four days, 49 of them in one day.
