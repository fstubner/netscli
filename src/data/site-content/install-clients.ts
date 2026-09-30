import type { InstallClient } from './types';
import type { InstallSteps } from './install-types';

// The grid is step 1; step 2 is the first of tryCommands in install.ts.
//
// Labelled by how often each is done, because that is the difference between
// them. The plugin alone does not make handoff work: in a project that is not
// set up every tool only answers that it is not (src/mcp/server.ts
// notConfigured). What it buys is that the tools exist in every repo, so the
// agent can offer to run setup there. Setup is what makes a project work, and
// it wires the agents in the repo whether or not they have the plugin (all
// but Copilot CLI, which needs --global-mcp). No third "use it" step: the
// hero already shows the switch.
export const installSteps: InstallSteps = {
  install: 'Once per agent: install the plugin',
  after: 'Once per project: set it up',
  // Asking works because every tool in a project that is not set up says so
  // and tells the agent to offer setup (src/mcp/server.ts notConfigured);
  // without the plugin there are no tools there to ask. Running it yourself
  // needs nothing installed first.
  afterCards: [
    {
      name: 'Ask your agent',
      commands: ['Set up xtctx in this repo'],
      note: 'Needs the plugin from step 1.',
    },
    {
      name: 'Or run it yourself',
      commands: ['npx -y xtctx setup'],
      note: 'Works without the plugin.',
    },
  ],
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
