---
title: Commands
description: Every xtctx command and flag, and the five MCP tools agents call.
---

## Commands

| Command | What it does |
| --- | --- |
| `xtctx setup` | Opts this project in: managed instruction blocks, MCP config per tool, the Claude Code hook, and skill sync. |
| `xtctx status` | Reports what is wired and indexed here, and what to run next if something is not. |
| `xtctx scan` | Indexes this project's transcripts now, instead of waiting for an agent to ask. |
| `xtctx calibrate` | Measures which device on this machine embeds fastest, and uses it. |
| `xtctx disconnect <tool>` | Stops managing one tool in this project. Transcripts are left untouched. |
| `xtctx` | With no command, over non-interactive stdio, starts the MCP server. In a terminal it prints help. |

Every command except `calibrate`, which is about the machine rather than a project, takes `-p, --project <path>` to act on a project other than the current directory.

## Flags

| Flag | Command | Effect |
| --- | --- | --- |
| `-y, --yes` | setup, disconnect | Apply without prompting. Non-interactive setup syncs the built-in skill plus any already selected. |
| `--repair` | setup | Replace stale or duplicated generated blocks before writing. |
| `--global-mcp` | setup | Also write Copilot CLI's machine-wide MCP config. |
| `--global-mcp` | disconnect | Also remove xtctx from the machine-wide Antigravity and Copilot CLI configs. |
| `--all` | disconnect | Every supported tool. Also deletes `.xtctx/skills`. |
| `--embed` | scan | Vectorize every window still missing one, however long it takes. |
| `--no-calibrate` | scan | Skip the automatic device measurement. |
| `--force` | calibrate | Measure again even if this machine already has a result. |

## Indexing and devices

The MCP server indexes when it starts and on each call, reading only what each tool has appended since the last pass. It also vectorizes the backlog in the background when this machine's measured rate says the rest fits in fifteen minutes. Above that, `xtctx status` says so and names `xtctx scan --embed`.

The first time a machine embeds anything, xtctx times the model on each device available and remembers the fastest in `~/.xtctx/device.json`. You do not need to run `calibrate` for that; it is there to re-measure after a hardware change, or to see the numbers. The vectors are the same whichever device wins.

## MCP tools

| Tool | What it returns |
| --- | --- |
| `xtctx_recent_sessions` | Recent sessions in this project, from every indexed tool. |
| `xtctx_session_detail` | The raw messages of one session, by `session_ref`. |
| `xtctx_search_sessions` | Transcript windows matching a query, by meaning and keyword. `mode: "literal"` matches exact text straight in the transcript files, before indexing has finished. |
| `xtctx_continuity_status` | Wiring and index diagnostics. |
| `xtctx_handoff_manifest` | Stable session references and pointers to their detail, for an orchestrator. Stores no task state. |

Search falls back to keyword whenever vectors are missing or the embedding model is unavailable, and says so in its answer.
