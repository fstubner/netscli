import type { InstallClient } from './types';
import type { InstallSteps } from './install-types';

// The grid is step 1; step 2 is the first of tryCommands in install.ts.
export const installSteps: InstallSteps = {
  install: 'Install the plugin for your agent',
  after: 'Opt a project in',
  // True of every tool: in a project that is not set up each one answers
  // that it is not, names the command, and tells the agent to offer it
  // (src/mcp/server.ts notConfigured; the plugin's handoff skill).
  afterNote:
    'Or ask your agent to set xtctx up here: in a project that is not set up yet, its tools say so and it offers to run this for you.',
  use: {
    title: 'Switch agents',
    text: 'Open a different agent in the same project and ask it to pick up where the last one left off. It reads the earlier session through xtctx instead of asking you.',
  },
};

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
    kind: 'terminal',
    maker: 'Anthropic',
    commands: ['claude plugin marketplace add fstubner/xtctx', 'claude plugin install xtctx@xtctx'],
  },
  {
    name: 'Codex',
    kind: 'terminal',
    maker: 'OpenAI',
    commands: ['codex plugin marketplace add fstubner/xtctx', 'codex plugin add xtctx@xtctx'],
  },
  {
    name: 'Cursor',
    kind: 'editor',
    maker: 'Anysphere',
    commands: ['cursor-agent plugin marketplace add https://github.com/fstubner/xtctx'],
    note: 'Then install xtctx from /plugins in an interactive session.',
  },
  {
    name: 'Antigravity',
    kind: 'editor',
    maker: 'Google',
    commands: ['agy plugin install https://github.com/fstubner/xtctx'],
  },
  {
    name: 'Copilot CLI',
    kind: 'terminal',
    maker: 'GitHub',
    commands: ['copilot plugin marketplace add fstubner/xtctx', 'copilot plugin install xtctx@xtctx'],
  },
  {
    name: 'VS Code',
    kind: 'editor',
    maker: 'Microsoft',
    commands: [],
    note: 'No command-line route: install from the Chat view, with the chat.plugins.enabled setting on.',
  },
];
