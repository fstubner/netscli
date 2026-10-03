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
| `xtctx export` | Backs up this project's indexed sessions and messages to a JSON Lines file, including sessions whose transcripts are gone. Never overwrites a file. |
| `xtctx import <file>` | Merges an export into this project's index. Sessions keep their ids, so importing twice adds nothing new. |
| `xtctx embeddings enable` | Installs the optional local embedding model and its runtime (about 540 MB) so search can match by meaning as well as keyword. Asks first. |
| `xtctx embeddings disable` | Removes the model and its runtime. Search goes back to keyword only; the index is kept. |
| `xtctx calibrate` | Measures which device on this machine embeds fastest, and uses it. Needs semantic search enabled. |
| `xtctx login` | Signs in to the optional cloud sync with GitHub. Uploads nothing by itself. |
| `xtctx sync` | Cloud sync for this project: `enable` or `disable` uploading, `status`, `device [name]`, `token`, or no argument to upload once. |
| `xtctx logout` | Signs out of cloud sync and revokes your account's tokens. |
| `xtctx disconnect <tool>` | Stops managing one tool in this project. Transcripts are left untouched. |
| `xtctx` | With no command, over non-interactive stdio, starts the MCP server. In a terminal it prints help. |

`setup`, `status`, `scan`, `export`, `import`, `sync` and `disconnect` take `-p, --project <path>` to act on a project other than the current directory. The others are about the machine or your account rather than a project.

## Flags

| Flag | Command | Effect |
| --- | --- | --- |
| `-y, --yes` | setup, disconnect | Apply without prompting. Non-interactive setup syncs the built-in skill plus any already selected. |
| `-y, --yes` | embeddings enable | Install without asking, for scripts and agents. |
| `--repair` | setup | Also remove files left by older xtctx versions (`.xtctx/.store`, `.xtctx/tool-config`). The index is kept. |
| `--global-mcp` | setup | Also write Copilot CLI's machine-wide MCP config. |
| `--global-mcp` | disconnect | Also remove xtctx from the machine-wide Antigravity and Copilot CLI configs. |
| `--all` | disconnect | Every supported tool. Also deletes `.xtctx/skills`. |
| `-v, --verbose` | status | Include every format surprise, skill hashes and full paths. |
| `--embed` | scan | Vectorize every window still missing one, however long it takes. Needs semantic search enabled. |
| `--no-calibrate` | scan | With `--embed`, skip the automatic device measurement. |
| `-o, --out <file>` | export | Where to write. Defaults to `xtctx-export-<time>.jsonl` in the current directory; `-` writes to stdout. |
| `--force` | calibrate | Measure again even if this machine already has a result. |
| `--device <name>` | login | The name this device shows as in the cloud. Defaults to a random label. |
| `--sync-url <url>` | login | A sync server other than the default. |
| `-w, --watch` | sync | Keep uploading every few seconds until interrupted. |
| `--delete-data` | logout | Also delete everything uploaded to your cloud account. |

## Indexing and devices

The MCP server indexes when it starts and on each call, reading only what each tool has appended since the last pass.

Semantic search is off until you run `xtctx embeddings enable`, and every search is keyword-only until then. Once it is on, the server also vectorizes the backlog in the background when this machine's measured rate says the rest fits in fifteen minutes. Above that, `xtctx status` says so and names `xtctx scan --embed`.

The first time a machine embeds anything, xtctx times the model on each device available and remembers the fastest in `~/.xtctx/device.json`. You do not need to run `calibrate` for that; it is there to re-measure after a hardware change, or to see the numbers. The vectors are the same whichever device wins.

## Cloud sync

Optional, and off unless you opt in. Nothing is uploaded until you have signed in with `xtctx login` and, in each project you want uploaded, run `xtctx sync enable`. An opted-in project's transcript text goes to the xtctx cloud server, where your agents on other machines can read it over MCP. `xtctx sync disable` stops further uploads; `xtctx logout --delete-data` deletes what was sent. What is and is not uploaded is listed in [docs/cloud-sync.md](https://github.com/fstubner/xtctx/blob/main/docs/cloud-sync.md).

## MCP tools

| Tool | What it returns |
| --- | --- |
| `xtctx_recent_sessions` | Recent sessions in this project, from every indexed tool. |
| `xtctx_session_detail` | The raw messages of one session, by `session_ref`. |
| `xtctx_search_sessions` | Transcript windows matching a query, by keyword, and by meaning too once semantic search is enabled. `mode: "literal"` matches exact text straight in the transcript files, before indexing has finished. |
| `xtctx_continuity_status` | Wiring and index diagnostics. |
| `xtctx_handoff_manifest` | Stable session references and pointers to their detail, for an orchestrator. Stores no task state. |

Search falls back to keyword whenever vectors are missing or the embedding model is unavailable, and says so in its answer.
