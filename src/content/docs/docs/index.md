---
title: Overview
description: What xtctx is, what it deliberately does not do, and where to go next.
---

xtctx is local cross-tool handoff for AI coding agents. Your agents already write transcripts of every session. xtctx indexes those files and serves them over MCP, so the next agent you open in a repo can list the recent sessions there, from any supported tool, and read the raw messages.

It is for a developer who switches between coding agents and wants the next one to pick up the work without a pasted recap.

## What it does not do

- **No summaries.** Agents read the raw transcript messages, which stay the source of truth.
- **No memory layer.** Nothing is curated or kept beyond an index that can be deleted and rebuilt.
- **No service.** There is no daemon, API server, dashboard or watcher. Each MCP client (Claude Code, Codex, Cursor and the rest) starts its own xtctx server over stdio, shared by every chat in that client, and it stops when the client exits.
- **No upload by default.** Search runs a small embedding model on your machine. A project can opt into a remote embedding endpoint, but only by writing one into its config.

## Where to start

| If you want to | Go to |
| --- | --- |
| Install it and opt a project in | [Installation](/docs/install/) |
| Look up a command, a flag, or an MCP tool | [Commands](/docs/commands/) |

## Supported agents

Claude Code, Codex, Cursor, GitHub Copilot in VS Code, GitHub Copilot CLI, Google Antigravity, and opencode. Some get native MCP config or a startup hook; others get MCP config plus managed instructions. `xtctx status` shows which mode each one is in.

## Where data lives

| File | What it is |
| --- | --- |
| `.xtctx/config.yaml` | The project's xtctx configuration. |
| `.xtctx/skills/<id>/SKILL.md` | Project skills that setup syncs to each tool. |
| `.xtctx/state/xtctx.db` | The index. A rebuildable cache; never commit it. |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and others | Managed handoff blocks. Everything outside the `xtctx:begin` / `xtctx:end` fences is left as you wrote it. |
