import type { SectionCopy, SurfaceCard } from './types';

export const surfacesCopy: SectionCopy = {
  heading: 'What it does, and what it leaves alone',
  leadHtml:
    'xtctx reads the transcript files your agents already write. It adds an index and some wiring; it does not summarise, store memory, or run a service.',
};

export const surfaces: SurfaceCard[] = [
  {
    title: 'Five MCP tools',
    body:
      'The next agent lists recent sessions from any tool, opens the raw messages, and searches them by keyword or by meaning. Here Codex picks up where a Claude Code session in the same repo stopped. An orchestrator can ask for a manifest of stable session references instead.',
    // Captured 2026-09-24 with the built server (0.21.8) in a temporary
    // project, `my-app`. The earlier Claude Code session is synthetic, two
    // messages written for this, like the public demo's. The AGENTS.md text
    // is the block setup wrote there, edited only by removing lines (the
    // generated notice, the temp project path, and the sections below
    // Session Retrieval). Both tool results are what the server returned,
    // edited only by removing lines. The agent's own sentences are written
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
- Call \`xtctx_search_sessions\` only when you need semantic or keyword search across chronological transcript windows.
- Use \`xtctx_continuity_status\` for wiring and freshness diagnostics.
- External orchestrators can call \`xtctx_handoff_manifest\` for stable session references and raw-detail pointers; it does not persist task state.
<!-- xtctx:end -->`,
          highlight: [
            'xtctx_recent_sessions',
            'xtctx_session_detail',
            'xtctx_search_sessions',
            'xtctx_continuity_status',
            'xtctx_handoff_manifest',
          ],
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
  },
  {
    title: 'Setup writes files you can read',
    body:
      'Managed blocks in the instruction files each agent already reads, MCP config per tool, and the handoff skill in each tool’s own format. Everything outside the managed blocks is left as you wrote it.',
    flip: true,
    // Excerpt of real `xtctx setup -y` output in a fresh project, 2026-09-24.
    // Setup printed absolute paths; they are shown here relative to the
    // project. 18 files were written; five are shown.
    codeHtml: `<span style="color:var(--ui-code-comment)">$</span> npx -y xtctx setup
<span style="color:var(--ui-code-string)">xtctx setup complete</span> (18 changed, 0 unchanged)
  updated config .xtctx/config.yaml
  updated mcp:claude-code .mcp.json
  updated mcp:codex .codex/config.toml
  updated memory:claude-code CLAUDE.md
  updated hook:claude-code .claude/settings.json`,
  },
  {
    title: 'Local by default',
    body:
      'Transcripts stay where each agent wrote them and remain the source of truth. The index is a SQLite file in the project that can be deleted and rebuilt. Semantic search runs a small embedding model on this machine; sending text to a remote embedding endpoint is something a project has to configure by hand.',
    codeHtml: `<span style="color:var(--ui-code-key)">index</span> <span>.xtctx/state/xtctx.db</span>
├── <span>sessions</span>
├── <span>messages</span>
├── <span>retrieval_units</span>
├── <span>retrieval_units_fts</span>
└── <span>retrieval_unit_vectors</span>`,
  },
  {
    title: 'No service to run',
    body:
      'Each agent starts its own xtctx server over stdio and stops it when it exits. The server indexes when it starts and when it is asked, measures once which device on this machine embeds fastest, and keeps nothing running afterwards.',
    flip: true,
    codeHtml: `<span style="color:var(--ui-code-comment)">agent starts</span>  npx -y xtctx      <span style="color:var(--ui-code-comment)">(stdio)</span>
<span style="color:var(--ui-code-comment)">server</span>        indexes what is new
<span style="color:var(--ui-code-comment)">agent asks</span>    xtctx_recent_sessions
<span style="color:var(--ui-code-comment)">agent exits</span>   server exits with it`,
  },
];
