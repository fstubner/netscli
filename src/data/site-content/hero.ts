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
  // The handoff itself, rather than a status listing: it is the one picture
  // that shows what xtctx is for. It was the first feature card, below the
  // fold, while the hero showed diagnostics.
  //
  // Captured 2026-09-24 with the built server (0.21.8) in a temporary
  // project, `my-app`. The earlier Claude Code session is synthetic, two
  // messages written for this, like the public demo's. The AGENTS.md text
  // is the block setup wrote there, edited only by removing lines (the
  // generated notice, the temp project path, the last three Session
  // Retrieval bullets, and the sections below it). Both tool results are
  // what the server returned, edited only by removing lines. The agent's own sentences are written
  // for this panel.
  visual: {
    kind: 'agent-session',
    session: {
      title: 'my-app: Codex',
      files: ['.xtctx/config.yaml', 'src/routes/login.ts', 'AGENTS.md', 'CLAUDE.md', 'package.json'],
      open: {
        path: 'AGENTS.md',
        text: `<!-- xtctx:begin -->
# xtctx Handoff

Tool: codex
Integration mode: instruction-only

## Session Retrieval
- Call \`xtctx_recent_sessions\` to list recent local sessions.
- Call \`xtctx_session_detail\` with a \`session_ref\` for the raw transcript messages.
<!-- xtctx:end -->`,
        highlight: ['xtctx_recent_sessions', 'xtctx_session_detail'],
      },
      agentLabel: 'Codex',
      turns: [
        { role: 'user', text: 'Pick up where Claude Code left off.' },
        { role: 'agent', text: 'AGENTS.md says to call xtctx_recent_sessions first.' },
        {
          role: 'tool',
          call: 'xtctx_recent_sessions(limit: 3)',
          result: [
            '### 1. claude-code:a41c-login-limit',
            '- Preview: Add a rate limit to POST /login: 5 attempts a minute per IP.',
          ],
        },
        { role: 'agent', text: 'One recent session. Opening it.' },
        {
          role: 'tool',
          call: 'xtctx_session_detail(session_ref: "claude-code:a41c-login-limit")',
          result: [
            'Added the limiter in src/routes/login.ts with a default of 5 per minute. Tests pass. Not done yet: reading the limit from RATE_LIMIT_PER_MIN.',
          ],
        },
        {
          role: 'agent',
          text: 'The limiter is done. Next: read the limit from RATE_LIMIT_PER_MIN.',
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
