import type { Platform, PlatformInstall, SectionCopy, TryCommand } from './types';

export const installCopy: SectionCopy = {
  heading: 'Install, then opt a project in',
  leadHtml:
    'Install the plugin in the agents you use: it makes the tools reachable from every project and writes nothing into any of them. Then opt each project in with setup, which puts the handoff in front of the next agent without it having to ask.',
};

// Only used if install-clients.ts is emptied: the install section shows the
// per-client grid from there instead. Kept so the per-OS layout still has
// true content behind it.
const cliEntries = [
  {
    label: 'Install the plugin',
    command: 'claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx',
    hint:
      'Registers the MCP server and the handoff skill for every project, and writes nothing into any of them. Codex, Copilot, Cursor and Antigravity install from this repository too; the README has their commands.',
  },
  {
    label: 'Opt a project in',
    command: 'npx -y xtctx setup',
    hint:
      'Writes managed blocks into the instruction files each agent already reads, the Claude Code SessionStart hook, MCP config per tool, and the handoff skill. The only route for opencode.',
  },
  {
    label: 'Check what is wired',
    command: 'npx -y xtctx status',
    hint: 'Configured tools, indexed sessions per tool, skill drift, and what to run next.',
  },
  {
    label: 'Stop managing one tool',
    command: 'npx -y xtctx disconnect cursor',
    hint:
      'Removes that tool’s xtctx wiring from this project and leaves your transcripts untouched. The machine-global Antigravity and Copilot CLI configs need --global-mcp as well.',
  },
];

export const installByPlatform: Record<Platform, PlatformInstall> = {
  windows: { cli: cliEntries, desktop: [] },
  macos: { cli: cliEntries, desktop: [] },
  linux: { cli: cliEntries, desktop: [] },
};

export const tryCommands: TryCommand[] = [
  { comment: 'Opt this project in', command: 'npx -y xtctx setup' },
  { comment: 'See what is wired and indexed', command: 'npx -y xtctx status' },
  { comment: 'Every command', command: 'npx -y xtctx --help' },
];

export const installBinariesNote =
  'Needs Node 24 or later. opencode has no plugin xtctx can use, so for opencode setup is the whole install. The <a href="https://github.com/fstubner/xtctx#readme">README</a> covers every agent’s plugin command and where each one keeps its transcripts.';

export const installFromSource =
  'git clone https://github.com/fstubner/xtctx && cd xtctx && npm ci && npm run build && node dist/src/cli/index.js --help';

export const installNotes: string[] = [
  'Requires Node.js 24 or later.',
  'The plugin writes nothing into a project; run `npx -y xtctx setup` in each project you want handoff in.',
  'Copilot CLI has only a global MCP config; add `--global-mcp` to setup to write it.',
];
