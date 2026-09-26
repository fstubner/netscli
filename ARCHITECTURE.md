# xtctx — Architecture

One npm package, no services. Everything runs in the invoking process on the
developer's machine. `docs/architecture.md` describes module internals; this
document fixes the parts, how a handoff actually flows through them, the
boundaries between them, and what each part is allowed to trust.

## Parts

- **CLI** (`src/cli/`) — `setup`, `status`, `scan`, `calibrate`,
  `disconnect`, and the internal `--hook session-start` entry point. Bare `xtctx` on a non-TTY stdio pair
  starts the MCP server.
- **MCP server** (`src/mcp/`) — stdio JSON-RPC server exposing exactly five
  read-only tools. Spawned by coding agents via `npx -y xtctx`.
- **Scrapers** (`src/scrapers/`) — one per supported tool; read that tool's
  local transcript store and yield normalized conversation chunks,
  project-scoped and incremental. `AbstractScraper` is the documented
  third-party extension point.
- **Handoff index** (`src/handoff/`) — per-project SQLite database
  (`.xtctx/state/xtctx.db`, WAL, schema-versioned) holding sessions,
  messages, retrieval windows, FTS index, and embedding vectors. Refreshed
  on demand from the scrapers and at MCP server start. Derived from the
  transcripts, but not disposable: the index keeps sessions whose transcripts have since been deleted (Claude Code deletes them after 30 days by default), so for those it is the only copy. A database that will not
  open (corruption, schema mismatch) is moved aside to
  `xtctx.db.set-aside-<time>`, never deleted, and a new one is built.
- **Drift log** (`src/scrapers/drift-log.ts`) — per-tool record of the
  places another tool's transcripts did not match what the scraper expected,
  summarised once per scan and kept in `.xtctx/state/<tool>-drift.json`.
  A reader reports only what it did not expect: a step type it has never seen
  is drift, while one it knowingly does not extract is listed as a known gap,
  because a warning that fires on every scan is one nobody reads.
  Warnings alone reach only the host agent's stderr, which nothing retains;
  `xtctx status` reads these files back. Bounded: 50 distinct surprises per
  tool, discards counted rather than silent, and ties broken towards the
  newest so a full log still records a fresh format break. Writes take a lock
  file, because one project is normally served by several xtctx processes at
  once. Surprises quote untrusted transcript values, so control characters are
  stripped on the way in and on the way out.
- **Config writers** (`src/config/`) — setup/disconnect logic that edits
  other tools' config files (MCP config, managed instruction blocks,
  synced skills, the Claude Code hook in `.claude/settings.json`).
- **Landing site** (`landing/`) — static Astro site on GitHub Pages;
  no runtime relationship to the package.

## Lifecycle

The problem: you work in one tool, switch to another, and the second has no
idea what the first just did. The parts above exist to let the second read the
first's transcripts.

**Setup, once per project.** `xtctx setup` registers the MCP server in each
installed tool's own config format — seven of them, and no two alike
(`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` under a `servers` key
rather than `mcpServers`, TOML tables for Codex, a combined command array for
opencode, app-level JSON for Antigravity) — then writes managed instruction
blocks into the memory files those tools read, syncs the handoff skill, and
installs a startup hook where the tool supports one. Nothing runs afterwards;
there is no daemon to leave behind.

**Serving a call.** A coding agent spawns `npx -y xtctx` over stdio, gets the
five read-only tools, and the process exits when the agent is done with it.
The server starts a scan as it starts, and refreshes again on a call whose
indexed view has gone stale: every scraper reads its own tool's store, yields
only chunks attributable to this project, and the results land in
`.xtctx/state/xtctx.db`.

**How a conversation becomes searchable.** Messages are grouped into
overlapping retrieval windows — eight messages, stride four — so a hit carries
the turns around it rather than one orphaned line. Each window is indexed
twice: into FTS5 for keyword search, and as one embedding vector.

**Ranking.** `keyword` mode scores 0.75 keyword, 0.15 recency, 0.1 continuity.
`hybrid`, the default, blends 0.6 semantic with 0.4 keyword. Keyword position
comes from bm25 ordering but is rescored as a linear decay, because bm25
favours short documents and a one-line mention was outranking the paragraph
that decided something. Semantic matches are gated twice: a per-window floor
(0.62) and a per-query confidence floor (0.64). Those numbers belong to the
model — they are swept per model, not carried between them, and MiniLM's were
0.15 and 0.36. When nothing clears the second
one, semantic results are dropped wholesale and only keyword hits remain —
whether a query found anything is a property of the query, not of each window,
and no answer beats a confident wrong one.

**Hybrid is never worse than keyword**, at any level of vector coverage, and
the eval gates that. It has to be stated because it was silently false: the
vector query inner-joined the embeddings table, so a keyword hit on a window
not yet embedded was absent rather than ranked lower, and hybrid's recall
tracked the vectorized fraction — half embedded, half the recall; none
embedded, nothing at all. A partly-embedded index is the ordinary state of a
fresh one, so the default mode was reaching a fraction of what the cheaper
mode reached. Windows without a vector are now candidates scored on the
evidence they have, and one with no vector is treated as unknown similarity
rather than none, because scoring it zero penalises it for its position in a
queue.

**Bounded, so a tool call always returns.** Scanning gets four seconds,
vectorizing six, and an indexed view is treated as current for thirty. Work
left over resumes on the next call. A scan also warms the embedding model and
builds vectors under the same cap, because a process spawned per agent session
would otherwise never vectorize anything; `hybrid` deliberately answers from
keyword while the model is still loading, so the first call after a cold start
is fast rather than blocked.

**What comes back is raw.** Sessions, message text, and pointers — never a
generated summary. A recap is the lossy artefact this exists to replace, and
the transcripts remain authoritative.

## Boundaries

- **Scrapers → foreign stores:** read-only, always. SQLite stores open
  `readonly` + `fileMustExist`; JSONL stores are streamed. One unreadable
  file warns and is skipped; it never aborts the scrape cycle or advances
  the incremental cursor past unread content.
- **Project boundary:** every scraper filters to the current project root
  (encoded directory, session `cwd`/`directory` metadata, or
  `session.start` context). A session that cannot be attributed to a
  project is excluded under scoping — fail closed, with a warning.
- **Index ↔ MCP:** the MCP tools speak only to the `SessionService`
  interface; all SQL lives behind it, with bound parameters everywhere and
  clamped limits at both layers.
- **Config writers → other tools' files:** writes are atomic
  (temp + rename), merge under the tool's own root key, preserve unknown
  keys, preserve the file's line endings, and refuse to rewrite files they
  cannot parse (JSONC comments included) rather than clobber them. JSON is
  re-serialised, so formatting is normalised even though content is not.
  Managed markdown blocks touch nothing outside their markers — including the
  tail of the file, which is why setup does not trim it and removal gives back
  exactly the separator it added.
- **Process boundary:** the MCP server writes logs to stderr only — stdout
  is the JSON-RPC transport. The session-start hook fails open: it must
  never break a host agent's startup.
- **The session-start hook never scans.** It runs before the user's first
  turn, so its cost is added to every agent startup, and a scan of every
  transcript store on the machine takes seconds even bounded. It reads the
  index as it already stands (`listIndexedSessions`) and names the most
  recent session — a pointer to raw detail, not a summary of it. Slightly
  stale context instantly beats fresh context late.

## Trust

- **Transcript content is untrusted input end to end.** It comes from other
  processes' files, may be adversarial (a poisoned repo produces poisoned
  transcripts), and is ultimately fed to an LLM. The scraper layer treats it
  as data (no eval, no dynamic paths derived from it); the MCP layer fences
  message bodies, labels them untrusted, truncates oversized payloads, and
  redacts local paths from error text.
- **Tool arguments from the connected agent are untrusted.** Validated and
  clamped at the handler boundary; `session_ref` is only ever a bound SQL
  parameter, never a path.
- **`.xtctx/config.yaml` is semi-trusted.** It is repo-committable, so a
  cloned repo can point `storePath` anywhere on disk. Store paths are used
  read-only, but treat overrides in a foreign repo as a risk surface.
- **The index is trusted state, and not disposable.** It is built from the
  transcripts but keeps sessions whose transcripts have since been deleted,
  so it is never deleted: a corrupt index or one from an older schema is
  moved to `xtctx.db.set-aside-<time>` and rebuilt, one from a newer schema
  is refused, and `setup --repair` leaves it alone.
- **The registry and npm supply chain** are trusted at install time; CI
  pins action SHAs and publishes via OIDC with provenance, no long-lived
  tokens.
