---
title: Overview
description: What xtctx does and does not do, which agents it supports, and where its files live.
---

This page describes what xtctx does, what it does not do, which agents it supports, and which files it creates.

xtctx indexes the transcripts that your coding agents write and serves them over MCP. An agent in a project can list recent sessions from every supported tool and read the raw messages of any of them.

## What xtctx does not do

- **Summaries and memory.** xtctx generates no summaries and keeps no curated memory. The index holds the raw messages in order, and the transcripts remain the source of truth.
- **Background service.** xtctx runs no daemon, API server, dashboard or watcher. Each MCP client starts the MCP server over stdio, and the server exits when the client disconnects.
- **Upload.** Search runs on your machine. Two features send transcript text elsewhere, and both are opt-in per project: a remote embedding endpoint set in the project config, and [cloud sync](/docs/commands/#cloud-sync).

## Supported agents

- Claude Code
- Codex
- Cursor
- GitHub Copilot in VS Code
- GitHub Copilot CLI
- Google Antigravity
- opencode

Run `xtctx status` to see how each tool is connected. The hook mode is `executable` (Claude Code), `instruction-only`, or `mcp-only`.

## Files

Project files:

| File | Description |
| --- | --- |
| `.xtctx/config.yaml` | Project configuration. |
| `.xtctx/skills/<id>/SKILL.md` | Project skills that setup syncs to each tool. |
| `.xtctx/state/xtctx.db` | The index. Setup adds `state/` to `.xtctx/.gitignore`. |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/xtctx.mdc`, `.github/copilot-instructions.md` | Instruction files that contain a managed xtctx block. |

xtctx owns only the text between `<!-- xtctx:begin -->` and `<!-- xtctx:end -->` in an instruction file. It does not change anything outside those fences.

Machine-wide state lives in `~/.xtctx/`: `embeddings/` (the local model, present only after `xtctx embeddings enable`) and `device.json` (the calibrated embedding device). Cloud sync adds `credentials.json`, `cloud-projects.json` and `sync/`: login, the list of projects that upload, and upload state.

:::caution
The index holds raw conversation text. Do not commit it.

The index is also the only copy of sessions whose transcripts are gone. Claude Code deletes transcripts older than 30 days by default (its `cleanupPeriodDays` setting). Back up the index with `xtctx export`.
:::

## Next

| To | See |
| --- | --- |
| Install xtctx and set up a project | [Installation](/docs/install/) |
| Look up a command, option or MCP tool | [Commands](/docs/commands/) |
