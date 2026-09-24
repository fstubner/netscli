import type { Terminal } from './terminal-types';

// The hero terminal panel, rendered to public/assets/hero.png by
// `npm run assets:terminal`.
//
// An excerpt of `xtctx status` as it printed in this repository on
// 2026-09-24 (xtctx 0.21.8, Windows). Edited only by removing lines: the
// Project/Config/Index/MCP/Scan/Data/Device rows (Data is wider than the
// panel), the three tools with no sessions yet,
// and every section after Tools. Invoked as `node dist/src/cli/index.js
// status`; the prompt line shows the published command instead.
export const terminal: Terminal = {
  title: 'xtctx status',
  chrome: 'windows',
  lines: [
    [['> ', 'prompt'], ['npx -y xtctx status', 'command']],
    [['xtctx 0.21.8 - handoff status', 'strong']],
    null,
    [['Tools:', 'accent']],
    [['  + ', 'ok'], ['claude-code   detected; 21 sessions; hook: executable', 'text']],
    [['  + ', 'ok'], ['cursor        detected; 4 sessions; hook: instruction-only', 'text']],
    [['  + ', 'ok'], ['codex         detected; 14 sessions; hook: instruction-only', 'text']],
    [['  + ', 'ok'], ['antigravity   detected; 16 sessions; hook: instruction-only', 'text']],
  ],
};
