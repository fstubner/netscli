---
title: Commands
description: Every xtctx command, option and MCP tool.
---

This page lists every xtctx command, option and MCP tool.

## Commands

| Command | Description |
| --- | --- |
| `xtctx setup` | Sets up the current project: instruction blocks, MCP config, the Claude Code hook and skills. |
| `xtctx status` | Reports what is configured and indexed, and the next step. |
| `xtctx scan` | Indexes the project's transcripts now. The MCP server otherwise indexes at start and on each tool call, reading only what is new. During a long first scan, tool calls answer with what is indexed so far and name the tools not read yet. |
| `xtctx export` | Writes the project's indexed sessions, including those whose transcripts are deleted, to a JSON Lines file. Never overwrites a file. The file holds raw conversation text, so do not commit it. |
| `xtctx import <file>` | Merges an export into the project's index. Importing the same file twice adds nothing. |
| `xtctx embeddings enable` | Installs the local embedding model and runtime for semantic search. Prompts first. |
| `xtctx embeddings disable` | Removes the model and runtime. Search returns to keyword only. |
| `xtctx calibrate` | Saves the fastest embedding device in `~/.xtctx/device.json`. Runs on the first embedding. Requires semantic search. |
| `xtctx login` | Signs in to cloud sync with GitHub. Uploads nothing. |
| `xtctx sync [action]` | Controls cloud sync for the project: `enable`, `disable`, `status`, `device [name]`, `token`, or no action to upload once. See [Cloud sync](#cloud-sync). |
| `xtctx logout` | Signs out of cloud sync and revokes the account's tokens. |
| `xtctx disconnect [tool]` | Stops xtctx managing a tool in the project. Transcripts are untouched. See [Remove xtctx](/docs/install/#remove-xtctx). |
| `xtctx` | Starts the MCP server over non-interactive stdio. Prints help in a terminal, or when `XTCTX_NO_AUTO_MCP=1` is set. |

## Options

`setup`, `status`, `scan`, `export`, `import`, `sync` and `disconnect` accept `-p, --project <path>` to target another project.

| Option | Command | Description |
| --- | --- | --- |
| `-y, --yes` | `setup`, `disconnect`, `embeddings enable` | Skips the prompt. Non-interactive `setup` syncs the built-in skill and skills already selected in the config. |
| `--repair` | `setup` | Removes files left by older versions (`.xtctx/.store`, `.xtctx/tool-config`), not the index. |
| `--global-mcp` | `setup` | Also writes Copilot CLI's machine-wide MCP config. |
| `--global-mcp` | `disconnect` | Also removes xtctx from the machine-wide Antigravity and Copilot CLI configs, which affect every project and are otherwise left in place. |
| `--all` | `disconnect` | Disconnects every tool and deletes `.xtctx/skills`. |
| `-v, --verbose` | `status` | Adds every format surprise, skill hashes and full paths. |
| `--embed` | `scan` | Embeds every window that has no vector. Requires semantic search. |
| `--no-calibrate` | `scan` | With `--embed`, skips device calibration. |
| `-o, --out <file>` | `export` | Default: `xtctx-export-<time>.jsonl` here. `-` writes to stdout. |
| `--force` | `calibrate` | Measures again, for example after a hardware change. |
| `--device <name>` | `login` | Name that this device shows in the cloud. Default: a random label. |
| `--sync-url <url>` | `login` | Sync server URL. Default: `https://sync.xtctx.com`. |
| `-w, --watch` | `sync` | Uploads every 10 seconds until interrupted. |
| `--delete-data` | `logout` | Also deletes everything uploaded to your cloud account. |

## Semantic search

Search is keyword-only until you run `xtctx embeddings enable`. After that, the MCP server builds vectors in the background if this machine's measured rate fits the remaining backlog in 15 minutes. For a larger backlog, `xtctx status` names `xtctx scan --embed`. Search falls back to keyword while vectors are missing or the model is unavailable; `xtctx status` reports why.

## Cloud sync

Cloud sync is optional and off by default. A project uploads only after you complete both steps:

1. Run `xtctx login`.
2. In each project to upload, run `xtctx sync enable`.

An enabled project uploads its transcript text to the xtctx cloud server, where agents on your other machines can read it over MCP. While an agent runs the MCP server in the project, the server uploads every 10 seconds.

:::caution
Uploaded message text is sent as written. It can contain file paths, command output and secrets. Enable sync only for projects whose transcripts you are willing to upload.
:::

`xtctx sync disable` stops further uploads and keeps what was uploaded. `xtctx logout --delete-data` deletes it. `xtctx sync token` prints a read-only token for an MCP client that cannot sign in itself.

[Cloud sync](https://github.com/fstubner/xtctx/blob/main/docs/cloud-sync.md) lists what is and is not uploaded.

## MCP tools

| Tool | Description |
| --- | --- |
| `xtctx_recent_sessions` | Lists recent sessions from every indexed tool. |
| `xtctx_session_detail` | Returns one session's raw messages by `session_ref`, the newest by default. |
| `xtctx_search_sessions` | Searches transcript windows and returns matching sessions. |
| `xtctx_continuity_status` | Returns wiring and index diagnostics. |
| `xtctx_handoff_manifest` | Returns stable session references and detail pointers, for an orchestrator. |

`xtctx_search_sessions` takes a `mode`: `hybrid` (default: keyword, plus semantic when enabled), `keyword`, `vector` or `literal`. `vector` errors when semantic search is off. `literal` matches text in the transcript stores without the index, so it answers before indexing finishes.
