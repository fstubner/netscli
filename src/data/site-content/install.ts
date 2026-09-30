import type { Platform, PlatformInstall, SectionCopy, TryCommand } from './types';

export const installCopy: SectionCopy = {
  heading: 'Install, then opt a project in',
  leadHtml:
    'The plugin makes xtctx available in every repo and writes nothing into any of them, so your agent can set a project up when you ask. Setup is what makes a project work: it wires the agents there and puts the handoff in front of the next one without it having to ask.',
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

// Only setup: status and --help are in the docs' command reference. As
// links under the install steps they read as an afterthought.
export const tryCommands: TryCommand[] = [
  { comment: 'Opt this project in', command: 'npx -y xtctx setup' },
];

export const installBinariesNote =
  'Needs Node 24 or later. opencode has no plugin, so for opencode setup is the whole install.';

export const installFromSource =
  'git clone https://github.com/fstubner/xtctx && cd xtctx && npm ci && npm run build && node dist/src/cli/index.js --help';

export const installNotes: string[] = [
  'Requires Node.js 24 or later.',
  'The plugin writes nothing into a project; run `npx -y xtctx setup` in each project you want handoff in.',
  'Copilot CLI has only a global MCP config; add `--global-mcp` to setup to write it.',
];
