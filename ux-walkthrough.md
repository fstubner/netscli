# xtctx — UX Walkthrough

## Primary job

A developer working in one AI coding tool switches to another and wants the
new tool to know what just happened. Concretely: after working in Codex,
open Claude Code in the same project and have it retrieve the Codex session's
content through xtctx without any manual export.

## Steps

1. **Install xtctx.** The client then shows `xtctx` among its MCP servers and
   `xtctx-handoff` among its skills. Two routes register exactly that:
   - *Plugin — no project setup:* `claude plugin marketplace add
     fstubner/xtctx && claude plugin install xtctx@xtctx`. The project
     directory is untouched; `git status` shows nothing new.
   - *Setup — adds automatic delivery:* `npx -y xtctx setup` in the project
     root, which additionally writes one line per file: an MCP entry per
     detected tool, managed blocks in CLAUDE.md / AGENTS.md / GEMINI.md /
     rules, synced skills, and the SessionStart hook in
     `.claude/settings.json`. Interactive runs show the whole write plan and
     ask; `--yes` applies it. A second run reads `ok` on every line rather
     than `updated`, which is what idempotent looks like here.
2. **Check the wiring.** `xtctx status` shows config path, index counts,
   per-tool detection, any last scrape error, skill-sync drift, and a final
   `Next` line. On a plugin-only project `Config` reads
   `missing (run xtctx setup)`, and that is the whole story there: the MCP
   tools answer every call by naming `xtctx setup` until it has been run,
   because a project nobody opted in has no index to read.
3. **Work normally.** No daemon runs. Each agent starts its own xtctx MCP
   server, which scans when it starts — and, the first time on a machine,
   measures which device embeds fastest — then works through any vector
   backlog that fits a fifteen-minute budget, and stops with the agent.
4. **Hand off.** Ask the next tool what you were working on and it returns the
   other tool's work rather than asking you. The managed block tells the agent
   the tools exist, and Claude Code's session-start hook also names the most
   recent session; the agent then calls
   `xtctx_recent_sessions`, which returns the *other* tool's sessions with
   timestamps and branches. `xtctx_session_detail` on one of those
   `session_ref`s returns the raw messages; `xtctx_search_sessions` returns
   keyword or semantic matches. Indexing also happens inside these calls, so
   the first on a large history returns partial results and later ones return
   more — a thin first answer means the index is still filling, not that the
   history is empty. Orchestrators use `xtctx_handoff_manifest` for stable
   refs.
5. **Leave cleanly.** `xtctx disconnect <tool>` (or `--all`) shows its plan,
   asks (or `--yes`), and returns one line per removal — MCP entries, managed
   blocks, synced skills and hooks go; transcript data and user content stay.
   It then names the project's own `.xtctx/` directory, which holds the index
   built from transcript content, as left in place. Mostly project-scoped,
   with one exception it warns about up front: Antigravity keeps its MCP
   config at app level, so disconnecting it removes xtctx from Antigravity for
   every project on the machine. In a directory that was never set up it
   instead reads `not configured for xtctx — nothing to disconnect` and
   changes nothing, that global config included.

## States

- **Empty (fresh project):** status reports `0 sessions` and says exactly
  what to do next ("Ask a configured agent to call xtctx_recent_sessions").
  MCP tools return "No matching sessions found." rather than errors.
- **Tool not installed:** listed as `not detected`; setup still writes its
  project config so the tool works if installed later.
- **Store unreadable / scraper failing:** the scrape error is recorded and
  surfaced in `status` and `xtctx_continuity_status` (`last scrape error:`),
  while other tools keep indexing. The cursor never skips past unread
  content.
- **Corrupt index:** moved aside to `xtctx.db.set-aside-<time>` (never
  deleted) and rebuilt from the transcripts still on disk on next use.
  `setup --repair` does not touch the index.
- **Unparsable/commented user config:** left byte-identical; setup reports
  a warning (comments) or a structured failure with exit code 1 (invalid),
  never a clobber.
- **Non-interactive without `--yes`:** setup/disconnect refuse rather than
  guess. Bare `xtctx` with piped stdio starts the MCP server by design;
  `XTCTX_NO_AUTO_MCP=1` opts out.
- **Hook failure:** the session-start hook always exits 0 — a broken config
  or index never breaks the host agent's startup. It prints the handoff
  banner when it can and nothing at all when it cannot.
