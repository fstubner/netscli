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
      'The next agent lists recent sessions from any tool, opens the raw messages, and searches them by keyword or by meaning. An orchestrator can ask for a manifest of stable session references instead.',
    codeHtml: `<span style="color:var(--ui-code-comment)">list</span>     xtctx_recent_sessions
<span style="color:var(--ui-code-comment)">read</span>     xtctx_session_detail
<span style="color:var(--ui-code-comment)">search</span>   xtctx_search_sessions
<span style="color:var(--ui-code-comment)">check</span>    xtctx_continuity_status
<span style="color:var(--ui-code-comment)">hand off</span> xtctx_handoff_manifest`,
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
