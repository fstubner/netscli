---
title: Commands
description: Reference for every xtctx command and option, and for the five MCP tools.
---

This page is the reference for every xtctx command, its options, and the MCP tools that agents call.

## Commands

| Command | Description |
| --- | --- |
| `xtctx setup` | Sets up the current project: managed instruction blocks, MCP config per tool, the Claude Code hook, and skill sync. |
| `xtctx status` | Reports what is configured and indexed in the project, and the next step if something is missing. |
| `xtctx scan` | Indexes the project's transcripts now, instead of waiting for an agent to call a tool. |
| `xtctx export` | Writes the project's indexed sessions and messages to a JSON Lines file, including sessions whose transcripts are deleted. Never overwrites a file. The file contains raw conversation text, so do not commit it. |
| `xtctx import <file>` | Merges an export into the project's index. Sessions keep their ids, so importing the same file twice adds nothing. |
| `xtctx embeddings enable` | Installs the local embedding model and runtime (about 540 MB) for semantic search. Prompts first. |
| `xtctx embeddings disable` | Removes the model and runtime. Search returns to keyword only. The index is kept. |
| `xtctx calibrate` | Measures the embedding device on this machine and selects the fastest. Requires semantic search. |
| `xtctx login` | Signs in to cloud sync with GitHub. Uploads nothing. |
| `xtctx sync [action]` | Controls cloud sync for the project: `enable`, `disable`, `status`, `device [name]`, `token`, or no action to upload once. See [Cloud sync](#cloud-sync). |
| `xtctx logout` | Signs out of cloud sync and revokes the account's tokens. |
| `xtctx disconnect [tool]` | Stops xtctx managing a tool in the project. Transcripts are untouched. |
| `xtctx` | Starts the MCP server over non-interactive stdio. Prints help in a terminal, or when `XTCTX_NO_AUTO_MCP=1` is set. |

## Options

`setup`, `status`, `scan`, `export`, `import`, `sync` and `disconnect` accept `-p, --project <path>` to act on a project other than the current directory.

| Option | Command | Description |
| --- | --- | --- |
| `-y, --yes` | `setup`, `disconnect` | Applies the changes without prompting. Non-interactive `setup` syncs the built-in skill and any skills already selected in the config. |
| `-y, --yes` | `embeddings enable` | Installs without prompting. |
| `--repair` | `setup` | Removes files left by older xtctx versions (`.xtctx/.store`, `.xtctx/tool-config`). The index is kept. |
| `--global-mcp` | `setup` | Also writes Copilot CLI's machine-wide MCP config. |
| `--global-mcp` | `disconnect` | Also removes xtctx from the machine-wide Antigravity and Copilot CLI configs. |
| `--all` | `disconnect` | Disconnects every supported tool and deletes `.xtctx/skills`. |
| `-v, --verbose` | `status` | Includes every format surprise, skill hashes and full paths. |
| `--embed` | `scan` | Embeds every transcript window that has no vector, however long it takes. Requires semantic search. |
| `--no-calibrate` | `scan` | With `--embed`, skips the automatic device measurement. |
| `-o, --out <file>` | `export` | Output file. Default: `xtctx-export-<time>.jsonl` in the current directory. `-` writes to stdout. |
| `--force` | `calibrate` | Measures again even if this machine already has a result. |
| `--device <name>` | `login` | Name that this device shows in the cloud. Default: a random label. |
| `--sync-url <url>` | `login` | Sync server URL. Default: `https://sync.xtctx.com`. |
| `-w, --watch` | `sync` | Uploads every 10 seconds until interrupted. |
| `--delete-data` | `logout` | Also deletes everything uploaded to your cloud account. |

## Indexing

The MCP server indexes when it starts and on each tool call. It reads only what each transcript store has appended since the previous pass.

The first scan of a large history can take minutes. Until it finishes, tool calls answer with what is indexed so far and name the tools that are not read yet.

## Semantic search

Search is keyword-only until you run `xtctx embeddings enable`. After that, the MCP server builds vectors in the background if this machine's measured rate shows that the remaining backlog fits in 15 minutes. For a larger backlog, `xtctx status` reports it and names `xtctx scan --embed`.

Search falls back to keyword while vectors are missing or the embedding model is unavailable. `xtctx status` reports the reason.

The first time a machine embeds anything, xtctx times the model on each available device and saves the fastest in `~/.xtctx/device.json`. Vectors are identical on every device. Run `xtctx calibrate --force` to measure again after a hardware change.

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
| `xtctx_recent_sessions` | Lists recent sessions in the project, from every indexed tool. |
| `xtctx_session_detail` | Returns the raw messages of one session, by `session_ref`. Returns the newest messages by default. |
| `xtctx_search_sessions` | Searches transcript windows and returns the matching sessions. |
| `xtctx_continuity_status` | Returns wiring and index diagnostics. |
| `xtctx_handoff_manifest` | Returns stable session references and pointers to their detail, for an orchestrator. Stores no task state. |

`xtctx_search_sessions` takes a `mode`: `hybrid` (default: keyword, plus semantic when enabled), `keyword`, `vector` or `literal`. `vector` returns an error when semantic search is off. `literal` matches text directly in the transcript stores without the index, so it answers before indexing finishes.
