---
title: Installation
description: Install the xtctx plugin, opt a project in with setup, and check that it worked.
---

xtctx needs Node.js 24 or later. There are two ways in, and they compose: most people end up with both.

## The plugin

The plugin registers the MCP server and the handoff skill for every project, and writes nothing into any of them.

```bash
claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx
```

```bash
codex plugin marketplace add fstubner/xtctx && codex plugin add xtctx@xtctx
```

```bash
copilot plugin marketplace add fstubner/xtctx && copilot plugin install xtctx@xtctx
```

```bash
agy plugin install https://github.com/fstubner/xtctx
```

Cursor registers the marketplace from its agent CLI, then installs from `/plugins` in an interactive session:

```bash
cursor-agent plugin marketplace add https://github.com/fstubner/xtctx
```

VS Code has no command-line route: plugins are managed from the Chat view, behind the `chat.plugins.enabled` setting. opencode does not support this plugin format, so setup is its only route.

In a project that has not been set up, every tool says so and names the setup command, so the agent can offer to run it. Nothing is scanned or written until then.

## Setup, once per project

```bash
npx -y xtctx setup
```

Setup writes managed blocks into the instruction files each agent already reads, so the next agent gets the handoff without deciding to ask for it. It also writes MCP config for each tool, the Claude Code SessionStart hook, and the handoff skill in each tool's own format.

Two tools keep a single MCP config for the whole machine. Setup always writes Antigravity's, because it has no per-project file. Copilot CLI's is written only when you add `--global-mcp`.

| | Plugin | Setup |
| --- | --- | --- |
| MCP tools | yes | yes |
| Handoff skill | yes | yes |
| Reachable from every project | yes | no |
| Context without the agent asking | no | yes |
| SessionStart hook (Claude Code) | no | yes |
| Writes into your project | no | yes |

## Check it worked

```bash
npx -y xtctx status
```

Restart any agent that was already open: MCP clients read their config when they start. Until an agent has called a tool once, status reports `Scan never` and no sessions, which is expected.

The first scan of a large history builds the index from scratch and can take minutes. Calls answer within a time budget with what has been indexed so far, and say which tools have not been read yet.

## Removing it

```bash
npx -y xtctx disconnect cursor
```

Stops managing one tool in this project. `--all` removes every tool. Neither deletes your transcripts or the project's `.xtctx` directory. The machine-wide Antigravity and Copilot CLI configs are left alone unless you add `--global-mcp`, because removing them affects every project on the machine.
