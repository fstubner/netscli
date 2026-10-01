# xtctx — Product Contract

## Purpose

Local cross-tool handoff for AI coding agents. Developers who switch between
Claude Code, Codex, Cursor, Copilot, Antigravity, opencode, and Copilot CLI
lose conversational context at every switch. xtctx indexes each tool's local
transcript store into a per-project SQLite index and serves it back — to any
of those tools — through a small read-only MCP server, so the next agent can
pick up where the last one left off.

Raw local transcripts are authoritative while they exist. xtctx never
summarizes and never persists derived "memory". The index is derived from
the transcripts for every session still on disk, and is the only copy of the
older ones whose transcripts have since been deleted (Claude Code deletes
them after 30 days by default). Deleting the index loses those, so xtctx
never deletes it: schema upgrades migrate it in place, a corrupt one is set
aside and its sessions carried into the rebuilt one, and `xtctx export` /
`xtctx import` keep a copy elsewhere. It sends transcript content nowhere
unless the user opts a project in to one of two things, both off by default
and both reported by `xtctx status`: cloud sync (`xtctx login` and then
`xtctx sync enable` in that project), or an external embedding endpoint,
written into `.xtctx/config.yaml` by hand and trusted by the user in
`XTCTX_TRUSTED_EMBEDDING_ENDPOINTS` (a repository cannot set that).

## Users

- **Primary:** individual developers who use two or more AI coding tools in
  the same project and want the next tool to know what the previous one did.
- **Secondary:** orchestrators (scripts or agents driving several coding
  tools) that need stable session references and raw-detail pointers —
  served by `xtctx_handoff_manifest`.

Single-user. Handoff itself is single-machine and needs no server. The one
exception is optional cloud sync, opt-in per project: a logged-in user can
upload an opted-in project's transcripts so agents on their other machines can
read them over MCP ([docs/cloud-sync.md](docs/cloud-sync.md)). There is no
team or shared component.

## Success

- After `xtctx setup`, an agent in any configured tool can call
  `xtctx_recent_sessions` and retrieve real transcript content from a
  *different* tool's session in the same project, without manual export.
- Setup is reversible: `xtctx disconnect` removes xtctx's management without
  deleting transcript data. Markdown and other prose files come back
  byte-for-byte outside the managed block, trailing whitespace and blank lines
  included. JSON configs keep every key and value the user had, but are
  re-serialised, so their original formatting is not preserved; and an MCP
  config file that setup created may be left behind holding an empty server
  map.
- Only the current project's sessions are ever indexed or served — content
  from other projects on the machine never crosses the project boundary — with
  one exception the product states rather than hides: a committable
  `.xtctx/config.yaml` can point a tool's `storePath` somewhere else, and that
  redirect is reported by `xtctx status` and `xtctx_continuity_status` rather
  than blocked. A cloned repository can carry one, which is why it is
  surfaced.
- The demo smoke (`npm run demo:public`) proves the loop end-to-end against
  synthetic data on every release.

## MVP

- Scrapers for the seven supported tools, project-scoped, incremental, and
  tolerant of upstream schema drift (warn, never silently drop).
- One per-project SQLite index (`.xtctx/state/xtctx.db`) with keyword (FTS5)
  and, once the optional add-on is enabled with `xtctx embeddings enable`,
  semantic (local bge-small embeddings) search over chronological windows.
- Five read-only MCP tools: recent sessions, session detail, search,
  continuity status, handoff manifest.
- CLI: `setup` (wire MCP config, managed instruction blocks, skills, and the
  Claude Code SessionStart hook), `status`, `scan` (read the stores into the
  index now, `--embed` to finish vectorizing too), `embeddings enable|disable`
  (install or remove the optional local model; keyword search needs none of
  it), `calibrate` (time the embedding model on this machine's devices and use
  the fastest), `export` / `import` (keep a copy of the index's sessions
  outside it), `disconnect`, and for the optional cloud sync `login`,
  `logout` and `sync` (`sync enable` opts the current project in).

Out of scope (deliberately, and documented everywhere the product speaks):
no daemon, no API server, no dashboard, no generated summaries or briefs,
no durable memory, no write-back tools, and nothing leaves the machine unless
the user opts a project in to cloud sync, which is optional and off by
default.

## Constraints

- Node ≥ 24, distributed via npm (`npx -y xtctx`); no install step beyond
  what a coding agent's MCP config can express. The default install carries no
  ML runtime (about 55 MB on disk against 550 MB with it, measured), because
  an MCP client will not wait minutes for `npx` to fetch one: the local model
  is an add-on, installed by `xtctx embeddings enable`.
- Transcript stores belong to other tools: all reads are read-only
  (`readonly` + `fileMustExist` for SQLite stores) and must survive those
  tools changing their formats — drift is detected by tests, committed format
  fingerprints and an upstream release watch, with an on-demand canary against
  the real CLIs, and degrades with warnings rather than silent data loss.
- Config files written during setup belong to other tools too: writes are
  atomic, merge-preserving, and never clobber unparsable user content.
- Transcript content handed to a model is untrusted data; the MCP layer
  fences it and never grows write capabilities.
- Everything runs local by default. Four network dependencies exist. Two are
  unavoidable and narrow: the one-time embedding-model download from Hugging
  Face (and the runtime from npm), made only when the user runs
  `xtctx embeddings enable`, and loopback-only HTTPS calls to Antigravity's local language server
  (127.0.0.1, exact-PID + CSRF matched; certificate verification is off
  because the server is self-signed). The other two are opt-in, and they are
  the only ones that carry transcript text. One is an OpenAI-compatible
  embedding endpoint named in `.xtctx/config.yaml`: it is never inferred from
  the environment, the API key is never stored in that file, and `xtctx
  status` prints the endpoint whenever one is set. The other is cloud sync,
  which uploads an opted-in project's sessions to the xtctx cloud Worker
  (`cloud/`) only while someone is logged in; the opt-in list lives in the
  user's home directory, so a repository cannot opt itself in, and `xtctx
  status` says whether it is on ([docs/cloud-sync.md](docs/cloud-sync.md)).
