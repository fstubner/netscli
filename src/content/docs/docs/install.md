---
title: Installation
description: Install the xtctx plugin, set up a project, verify the result, enable semantic search, and remove xtctx.
---

This page covers installing the xtctx plugin, running setup in a project, verifying the result, enabling semantic search, and removing xtctx.

xtctx requires Node.js 24 or later.

## Plugin and setup

Install the plugin once per agent. Run setup once per project.

| | Plugin | Setup |
| --- | --- | --- |
| MCP tools and handoff skill | Yes | Yes |
| Available in every project | Yes | No |
| Instruction text that names the tools | No | Yes |
| Pointer to recent sessions at session start | No | Claude Code only |
| Writes files into the project | No | Yes |

In a project that has not been set up, every xtctx tool reports that the project is not configured and names the setup command. Nothing is scanned or written until setup runs.

## Install the plugin

The plugin registers the MCP server and the handoff skill for every project.

```bash
# Claude Code
claude plugin marketplace add fstubner/xtctx
claude plugin install xtctx@xtctx

# Codex
codex plugin marketplace add fstubner/xtctx
codex plugin add xtctx@xtctx

# GitHub Copilot CLI
copilot plugin marketplace add fstubner/xtctx
copilot plugin install xtctx@xtctx

# Google Antigravity
agy plugin install https://github.com/fstubner/xtctx

# Cursor: then install xtctx from /plugins in an interactive session
cursor-agent plugin marketplace add https://github.com/fstubner/xtctx
```

VS Code has no command-line route. Install the plugin from the Chat view, with the `chat.plugins.enabled` setting turned on. opencode does not support this plugin format, so use setup.

## Set up a project

1. From the project root, run:

   ```bash
   npx -y xtctx setup
   ```

2. Restart any agent that was open during setup. MCP clients read their config when they start.

Setup writes:

- Managed blocks in the instruction files that each agent reads. The blocks name the xtctx tools. The agent still has to call them.
- One MCP config entry per tool, pinned to the xtctx version that ran setup. Run setup again to move the pin.
- For Claude Code, a `SessionStart` hook that injects a short pointer to recent sessions.
- The handoff skill, in each tool's own format.
- `.xtctx/config.yaml` and a `.gitignore` that excludes the index.

Antigravity has no per-project MCP file, so setup always writes its machine-wide config. Copilot CLI has only a machine-wide config, which setup writes only with `--global-mcp`.

:::note
Claude Code applies the tool permissions that setup writes to `.claude/settings.json` only in a trusted workspace. Open the project in Claude Code once and accept the trust prompt. Until then, xtctx tool calls are refused.
:::

## Verify

Run `npx -y xtctx status`. It lists the configured tools, the indexed sessions per tool, and the next step.

- Until an agent has called an xtctx tool, status reports `Scan never` and no sessions. This is expected.
- In a project that has only the plugin, status reports the config as missing and names `xtctx setup`.

## Enable semantic search

Search matches keywords by default, and the default install is about 55 MB on disk. Semantic search also matches by meaning and uses a local embedding model.

Semantic search is set per machine, so it applies to plugin and setup installs alike. To enable it, run `npx -y xtctx embeddings enable` and answer the prompt. Add `--yes` to skip the prompt. To turn it off, run `npx -y xtctx embeddings disable`.

The command installs the model and runtime into `~/.xtctx/embeddings`, about 540 MB on disk. The MCP server then builds vectors in the background. See [Semantic search](/docs/commands/#semantic-search).

A project that uses a remote embedding endpoint does not need this command. See [Embedding providers](https://github.com/fstubner/xtctx/blob/main/docs/embedding-providers.md).

## Remove xtctx

To stop xtctx managing one tool in a project, run:

```bash
npx -y xtctx disconnect <tool>
```

`<tool>` is `claude-code`, `cursor`, `codex`, `copilot`, `antigravity`, `opencode` or `copilot-cli`. The command removes the tool's MCP entry, managed instruction block, hook and skill files, and marks the tool disabled in `.xtctx/config.yaml`. An instruction file that several tools read keeps its block until all of them are disconnected.

The command asks for confirmation. Add `--yes` to skip the prompt, which is required without a terminal.

| Option | Description |
| --- | --- |
| `--all` | Disconnects every tool and deletes `.xtctx/skills`. |
| `--global-mcp` | Also removes xtctx from the machine-wide Antigravity and Copilot CLI configs. Without it, those configs are left in place, because removing them affects every project on the machine. |

Disconnect never deletes your transcripts, `.xtctx/config.yaml` or the index.

:::caution
To remove xtctx from a machine completely, run `xtctx disconnect --all --global-mcp` in each set-up project, then delete each project's `.xtctx` directory. Run `xtctx export` first to keep sessions whose transcripts are already deleted. The index is the only copy of those sessions.
:::
