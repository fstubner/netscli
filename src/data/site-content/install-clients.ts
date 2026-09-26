import type { InstallClient } from './types';

// One card per client xtctx supports, from the README's plugin routes. The
// plugin registers the MCP server and the handoff skill for every project;
// `npx -y xtctx setup` then opts a project in, which is the "Then" block
// below the grid (tryCommands in install.ts).
//
// opencode is not a card: it has no plugin format xtctx can use, so its
// whole install is that setup step, and the note under the grid says so. As a
// seventh card it sat alone on a third row, repeating the command below it.
//
// No logos: only GitHub allows a third party to show its mark for an
// integration without asking (Anthropic, OpenAI and Google require approval;
// VS Code forbids it). `maker` says what each client is in words instead.
export const installClients: InstallClient[] = [
  {
    name: 'Claude Code',
    maker: 'Anthropic · terminal agent',
    commands: ['claude plugin marketplace add fstubner/xtctx', 'claude plugin install xtctx@xtctx'],
  },
  {
    name: 'Codex',
    maker: 'OpenAI · terminal agent',
    commands: ['codex plugin marketplace add fstubner/xtctx', 'codex plugin add xtctx@xtctx'],
  },
  {
    name: 'Cursor',
    maker: 'Anysphere · editor',
    commands: ['cursor-agent plugin marketplace add https://github.com/fstubner/xtctx'],
    note: 'Then install xtctx from /plugins in an interactive session.',
  },
  {
    name: 'Antigravity',
    maker: 'Google · editor',
    commands: ['agy plugin install https://github.com/fstubner/xtctx'],
  },
  {
    name: 'Copilot CLI',
    maker: 'GitHub · terminal agent',
    commands: ['copilot plugin marketplace add fstubner/xtctx', 'copilot plugin install xtctx@xtctx'],
  },
  {
    name: 'VS Code',
    maker: 'Microsoft · editor, with Copilot Chat',
    commands: [],
    note: 'No command-line route: install from the Chat view, with the chat.plugins.enabled setting on.',
  },
];
