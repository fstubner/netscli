---
title: Installation
description: Install, set up, verify and remove xtctx, and enable semantic search.
---

This page covers installing, setting up and removing xtctx, which requires Node.js 24 or later.

## Plugin and setup

Install the plugin once per agent and run setup once per project. The plugin gives every project the MCP tools and the handoff skill. Setup adds the files listed under [Set up a project](#set-up-a-project).

Until setup runs, every xtctx tool reports that the project is not configured and names the setup command, and nothing is scanned or written.

## Install the plugin

```bash
claude plugin marketplace add fstubner/xtctx
claude plugin install xtctx@xtctx

codex plugin marketplace add fstubner/xtctx
codex plugin add xtctx@xtctx

copilot plugin marketplace add fstubner/xtctx
copilot plugin install xtctx@xtctx

agy plugin install https://github.com/fstubner/xtctx

cursor-agent plugin marketplace add https://github.com/fstubner/xtctx
```

For Cursor, then install xtctx from `/plugins` in an interactive session. For VS Code, install the plugin from the Chat view with `chat.plugins.enabled` turned on. opencode does not support this plugin format, so use setup.

## Set up a project

1. Run, from the project root:

   ```bash
   npx -y xtctx setup
   ```

2. Restart any agent that was open during setup, because MCP clients read their config at start.

Setup writes:

- Managed blocks in each agent's instruction files, naming the xtctx tools. The agent still has to call them.
- One MCP config entry per tool, pinned to the xtctx version that ran setup. Run setup again to move the pin.
- For Claude Code, a `SessionStart` hook that injects a pointer to recent sessions.
- The handoff skill, in each tool's format.
- `.xtctx/config.yaml` and a `.gitignore` that excludes the index.

Setup always writes Antigravity's machine-wide MCP config, and Copilot CLI's only with `--global-mcp`.

:::note
Claude Code applies the tool permissions that setup writes to `.claude/settings.json` only in a trusted workspace. Open the project in Claude Code once and accept the trust prompt, or xtctx tool calls are refused.
:::

## Verify

Run `npx -y xtctx status` to list configured tools, indexed sessions per tool and the next step.

- Until an agent has called an xtctx tool, status reports `Scan never` and no sessions.
- With only the plugin, it reports the config as missing and names `xtctx setup`.

## Enable semantic search

Search matches keywords by default, and the default install is about 55 MB on disk. Semantic search also matches by meaning, with a local model.

Semantic search is set per machine, so it applies to plugin and setup installs alike. Run `npx -y xtctx embeddings enable` and answer the prompt (`--yes` skips it). It installs the model and runtime into `~/.xtctx/embeddings`, about 540 MB on disk, and the MCP server then builds vectors in the background; see [Semantic search](/docs/commands/#semantic-search). Run `npx -y xtctx embeddings disable` to turn it off.

A project that uses a remote embedding endpoint does not need it; see [Embedding providers](https://github.com/fstubner/xtctx/blob/main/docs/embedding-providers.md).

## Remove xtctx

To stop xtctx managing one tool in a project, run:

```bash
npx -y xtctx disconnect <tool>
```

`<tool>` is `claude-code`, `cursor`, `codex`, `copilot`, `antigravity`, `opencode` or `copilot-cli`. It removes the tool's MCP entry, managed instruction block, hook and skill files, and marks the tool disabled in `.xtctx/config.yaml`. An instruction file that several tools read keeps its block until all of them are disconnected.

`--yes` skips the confirmation prompt and is required without a terminal. For `--all` and `--global-mcp`, see [Options](/docs/commands/#options). Disconnect never deletes your transcripts, `.xtctx/config.yaml` or the index.

:::caution
To remove xtctx from a machine, run `xtctx disconnect --all --global-mcp` in each set-up project, then delete each project's `.xtctx` directory. Run `xtctx export` first: the index is the only copy of sessions whose transcripts are already deleted.
:::
