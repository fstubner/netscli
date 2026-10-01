# xtctx Architecture

xtctx has one job: reliable local handoff between AI coding tools.

Humans run `xtctx setup` and `xtctx status`. Agents use MCP tools to discover
recent local transcript or handoff-artifact sessions and retrieve raw local
detail on demand. xtctx does not run a background service, web UI,
generated-summary pipeline, or durable memory writeback layer.

The architecture is intentionally scoped to one local developer switching
between coding tools. Shared team memory and telemetry are outside the product
surface.

Cloud sync is the one optional part that leaves the machine, and it is opt-in
per project: only when the user has logged in (`xtctx login`) and opted the
project in (`xtctx sync enable`) does the MCP server upload that project's
index to the Worker in `cloud/`, every 10 seconds while it runs and once on
shutdown. The Worker serves the uploads back over MCP to the same user's
agents on other machines. It is not on the handoff path: everything above
works with it off, which is the default. See
[cloud-sync.md](cloud-sync.md) and [`cloud/README.md`](../cloud/README.md).

## Runtime Shape

```text
tool transcript/artifact stores
        |
        v
scrapers -> .xtctx/state/xtctx.db -> MCP tools
                                   -> setup/status diagnostics
                                   -> cloud upload (optional, opted-in projects only)
```

`.xtctx/state/xtctx.db` is built from the transcripts, which remain
authoritative while they exist. For every session still on disk the index is
derived data; for the older ones whose transcripts have since been deleted
(Claude Code deletes them after 30 days by default) it is the only copy, and
deleting it loses them. `xtctx status` counts those sessions, and `xtctx
export` / `xtctx import` keep a copy outside the index.

Antigravity is the exception to simple file parsing: its `.pb` conversation
files are treated as encrypted/private implementation detail. When Antigravity
is running, xtctx queries the local language-server API for full conversation
steps; when it is not running, xtctx falls back to readable `brain` artifacts.
Setup always writes Antigravity app-level MCP config and a managed `GEMINI.md`
instruction block (Antigravity CLI keeps project-memory compatibility with
that file).

## Setup

`xtctx setup` writes:

- `.xtctx/config.yaml`
- native MCP config using command `npx` and args `["-y", "xtctx@<version>"]`,
  pinned to the xtctx that ran setup
- managed instruction blocks for supported tools
- executable startup hooks only for tools that actually support them
- `.xtctx/skills/<skill-id>/SKILL.md` canonical project skills
- generated skill targets for tools with verified native or adapter surfaces

Managed blocks contain stable retrieval instructions, not generated narrative
summaries.

Interactive setup inventories compatible skills from connected tools and lets
the user select which project skills to sync. Non-interactive setup syncs only
the built-in `xtctx-handoff` skill plus any skills already selected in
`.xtctx/config.yaml`.

## Retrieval

The MCP surface is intentionally small:

- `xtctx_recent_sessions`
- `xtctx_session_detail`
- `xtctx_search_sessions`
- `xtctx_continuity_status`
- `xtctx_handoff_manifest`

`xtctx_recent_sessions` and `xtctx_session_detail` lazily scan local transcript
or artifact stores before returning. `xtctx_search_sessions` searches
chronological transcript windows stored in SQLite. `xtctx_handoff_manifest`
returns a read-only orchestrator envelope with stable session refs and
raw-detail pointers; it does not persist task state.

Startup hooks are lightweight handoff openers. They do not update the local
index unless a future hook explicitly calls a bounded scan path.

Semantic search is an optional add-on: until `xtctx embeddings enable`
installs the local model (or a project names an external endpoint), every
search is keyword-only, and status says so. Once on, it embeds sliding windows
of raw transcript turns. Each embedded window includes the session reference, message range, turn
order, message index, role, timestamp, and raw message content. Retrieval ranks
semantic similarity together with keyword, recency, and continuity signals, then
returns the matched message range so the agent can drill into the raw session.
Vector creation is incremental: searches vectorize a slice per call, and the
MCP server drains the rest in the background at startup when the estimate fits
its budget. If the embedding provider is unavailable during hybrid search,
xtctx falls back to keyword retrieval and records the reason, which
`xtctx status` and `xtctx_continuity_status` both report.

## Storage

The SQLite index stores:

- transcript sessions
- transcript messages
- FTS rows for keyword search
- chronological retrieval windows
- local embedding vectors as BLOBs
- setup/status metadata

Only sessions and messages hold anything that cannot be recomputed; the rest
is derived from messages. There is no required external database.

The schema is versioned, and an index from an older version is migrated in
place (`MIGRATIONS` in `src/handoff/schema.ts`), then the next scan re-reads
every transcript still on disk to refresh what an older build wrote. An index
that is corrupt, or older in a shape no migration recognises, is moved aside
to `xtctx.db.set-aside-<time>` rather than deleted, and a new one is built
from the transcripts still on disk; after that first full scan, every session
the new index lacks is copied in from the set-aside file, each read on its
own so a damaged page costs only the sessions on it. An index from a newer
schema is refused rather than set aside.

`xtctx export` writes the project's sessions and messages to a JSON Lines
file (format documented in `src/handoff/export-file.ts`) and `xtctx import`
merges one back. Message ids are content hashes, so importing twice adds
nothing; windows are rebuilt on import and vectors re-embedded as usual.

## Drift And Limits

Tool transcript stores are private implementation details of the upstream tools.
Each scraper tolerates known benign changes, warns on surprising record shapes,
and is covered by fixture, mutation, and drift-canary tests. `xtctx status`
reports what was actually detected and indexed on the current machine.

Antigravity conversation stores are private implementation details. The
scraper reads full conversation steps from the local Antigravity language
server when it is available, and otherwise falls back to readable handoff
artifacts.
