import type { SectionCopy, SurfaceCard } from './types';

// The problem first. The page went from the headline straight to how xtctx
// works, and never said why switching agents costs anything.
export const surfacesCopy: SectionCopy = {
  heading: 'Each agent keeps its own history',
  leadHtml:
    'Claude Code, Codex, Cursor and the others each write transcripts to their own folder, and none reads the others’. xtctx indexes them so the next agent you open can read what the last one did.',
};

// Lines in the code visuals stay under 40 characters where they are written
// for this page, so they fit a phone without scrolling. The setup excerpt is
// real output and is left at its own width.
export const surfaces: SurfaceCard[] = [
  {
    title: 'Five MCP tools',
    body:
      'Setup tells each agent when to call them. They return the transcript messages as written.',
    // One line of purpose per tool, from the tool descriptions in the
    // managed block setup writes (see the project CLAUDE.md).
    codeHtml: `xtctx_recent_sessions
<span style="color:var(--ui-code-comment)">  recent sessions, from any agent</span>
xtctx_session_detail
<span style="color:var(--ui-code-comment)">  one session's raw messages</span>
xtctx_search_sessions
<span style="color:var(--ui-code-comment)">  keyword search, semantic once enabled</span>
xtctx_continuity_status
<span style="color:var(--ui-code-comment)">  is the wiring in place, and fresh</span>
xtctx_handoff_manifest
<span style="color:var(--ui-code-comment)">  stable session refs for orchestrators</span>`,
  },
  {
    title: 'Setup writes files you can read',
    body:
      'Setup adds managed blocks to the instruction files each agent already reads, plus MCP config and the handoff skill for each tool. Everything outside the blocks is left as you wrote it.',
    flip: true,
    // Excerpt of real `xtctx setup --yes` output in a fresh project,
    // 2026-09-26, from the build of fix/cli-ux (1363d53, 23f3fea). Run on
    // Windows; the backslashes in its paths are shown as slashes, and the
    // kind column is padded to the widest kind shown here rather than to 34.
    // 18 files were written; five are shown, and the coverage note and next
    // steps after them are cut.
    codeHtml: `<span style="color:var(--ui-code-comment)">$</span> npx -y xtctx setup
<span style="color:var(--ui-code-string)">xtctx setup complete</span>: 18 created, 0 updated, 0 unchanged
  created  config                    .xtctx/config.yaml
  created  mcp:claude-code           .mcp.json
  created  mcp:codex                 .codex/config.toml
  created  instructions:claude-code  CLAUDE.md
  created  instructions:codex        AGENTS.md`,
  },
  {
    title: 'Local by default',
    body:
      'Transcripts stay where each agent wrote them, and the index is one SQLite file in the project that setup keeps out of git. A remote embedding endpoint and cloud sync are opt-in, per project.',
    codeHtml: `<span style="color:var(--ui-code-comment)"># transcripts: read, never moved</span>
~/.claude/projects/
<span style="color:var(--ui-code-comment)">…and each other agent's own folder</span>

<span style="color:var(--ui-code-comment)"># the index: one file, in the project</span>
.xtctx/state/xtctx.db`,
  },
  {
    title: 'No service to run',
    body:
      'Each MCP client starts its own xtctx and it exits when the client disconnects. Nothing keeps running in between.',
    flip: true,
    codeHtml: `<span style="color:var(--ui-code-comment)">you open Claude Code</span>
  → it starts its own xtctx
<span style="color:var(--ui-code-comment)">you ask for context</span>
  → xtctx reads what is new
<span style="color:var(--ui-code-comment)">you open Codex</span>
  → Codex starts its own
<span style="color:var(--ui-code-comment)">you close a client</span>
  → its xtctx exits with it`,
  },
];
