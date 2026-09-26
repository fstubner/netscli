import type { InstallClient } from './types';

// One card per client xtctx supports, from the README's plugin routes. The
// plugin registers the MCP server and the handoff skill for every project;
// `npx -y xtctx setup` then opts a project in, which is the "Then" block
// below the grid (tryCommands in install.ts).
//
// opencode is not a card: it has no plugin format xtctx can use, so its
// whole install is that setup step, and the note under the grid says so. As a
// seventh card it sat alone on a third row, repeating the command below it.
export const installClients: InstallClient[] = [
  {
    name: 'Claude Code',
    commands: ['claude plugin marketplace add fstubner/xtctx', 'claude plugin install xtctx@xtctx'],
  },
  {
    name: 'Codex',
    commands: ['codex plugin marketplace add fstubner/xtctx', 'codex plugin add xtctx@xtctx'],
  },
  {
    name: 'Cursor',
    commands: ['cursor-agent plugin marketplace add https://github.com/fstubner/xtctx'],
    note: 'Then install xtctx from /plugins in an interactive session.',
  },
  {
    name: 'Antigravity',
    commands: ['agy plugin install https://github.com/fstubner/xtctx'],
  },
  {
    name: 'Copilot CLI',
    commands: ['copilot plugin marketplace add fstubner/xtctx', 'copilot plugin install xtctx@xtctx'],
  },
  {
    name: 'VS Code',
    commands: [],
    note: 'No command-line route: install from the Chat view, with the chat.plugins.enabled setting on.',
  },
];
