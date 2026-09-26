import type { Hero, HeroCommands, HeroDownload } from './types';

export const hero: Hero = {
  // The name, spelled out: x (cross) · t (tool) · ctx (context). No
  // releaseLink: with one, the page replaces this text with the latest
  // version once GitHub answers, and the changelog is in the nav anyway.
  badge: 'Cross · Tool · Context',
  // A non-breaking hyphen (U+2011) in "re‑explaining": with a plain one the
  // balanced heading broke it across the two lines.
  heading: 'Switch coding agents without re‑explaining the work.',
  subhead:
    'xtctx indexes the transcripts your coding agents already write and serves them over MCP, so the next agent you open can read what the last one did. By default nothing leaves your machine.',
  // One command. Setup wires six of the seven supported agents in this
  // project (Copilot CLI's MCP config is machine-wide, so it needs
  // --global-mcp), so it is the route that works whichever agent a visitor
  // most likely uses; the per-agent
  // plugin commands are in the install section. The plugin one-liner used to
  // sit here too, cut off at `claude plugin …` because it did not fit.
  quickInstall: '',
  quickInstallAlt: 'npx -y xtctx setup',
  installLinkLabel: 'Or install the plugin for your agent',
  // The fallback picture, used only if `visual` below is removed. Rendered
  // from terminal.ts by `npm run assets:terminal`.
  heroImage: '/assets/hero.png',
  heroImageAlt: 'xtctx status in a terminal, listing indexed sessions per coding agent',
  heroImageWidth: 1200,
  heroImageHeight: 462,
  // The handoff itself, as two agents: a Claude Code session that stopped
  // with work left, and Codex picking it up without being told again. It
  // replaced one editor window with a file tree, an open AGENTS.md and full
  // tool output, which was accurate but too dense to read at a glance.
  //
  // The tool names are the real ones and the order is the real order:
  // recent sessions, then the raw messages of the one found. The session
  // ref is the one the captured server returned (2026-09-24, 0.21.8, in a
  // temporary project); the Claude Code session is synthetic, two messages
  // written for this, like the public demo's. The few words after each
  // tool name summarise what came back; the agents' sentences are written
  // for this panel.
  visual: {
    kind: 'handoff',
    bridge: 'xtctx',
    from: {
      agent: 'Claude Code',
      when: 'yesterday',
      turns: [
        { role: 'user', text: 'Add a rate limit to POST /login: 5 attempts a minute per IP.' },
        {
          role: 'agent',
          text: 'Added the limiter in src/routes/login.ts, 5 a minute. Tests pass. Still to do: read the limit from RATE_LIMIT_PER_MIN.',
        },
      ],
    },
    to: {
      agent: 'Codex',
      when: 'today',
      turns: [
        { role: 'user', text: 'Pick up where Claude Code left off.' },
        { role: 'tool', name: 'xtctx_recent_sessions', summary: 'claude-code:a41c-login-limit' },
        { role: 'tool', name: 'xtctx_session_detail', summary: 'its messages' },
        {
          role: 'agent',
          text: 'The limiter is done and tested. What is left is reading the limit from RATE_LIMIT_PER_MIN, so I am starting there.',
        },
      ],
    },
  },
  sourceUrl: 'https://github.com/fstubner/xtctx',
  // The nav already links GitHub; in the hero the link sat between the
  // subhead and the command.
  showSourceLink: false,
  // No desktop build; heroDownloads is empty, so neither is rendered.
  downloadLabel: '',
  downloadMenuLabel: '',
};

const commands = {
  packageManager: '',
  script: 'npx -y xtctx setup',
};

// Not OS-specific: the npx command is the same everywhere.
export const heroCommands: HeroCommands = {
  windows: commands,
  macos: commands,
  linux: commands,
};

export const heroDownloads: HeroDownload[] = [];
