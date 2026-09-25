import type { FaqItem, SectionCopy } from './types';

export const faqCopy: SectionCopy = {
  heading: 'Questions before using it in a repo',
  leadHtml: 'Short answers about setup, where data lives, and what xtctx does not do.',
};

// `a` is plain text and goes into the FAQ structured data and /llms.txt;
// `aHtml` is the rendered version and may add links and <code>. Keep the two
// saying the same thing.
export const faq: FaqItem[] = [
  {
    group: 'What it is',
    q: 'What problem does xtctx solve?',
    a: 'Switching coding agents mid-task usually means re-explaining the work. xtctx lets the agent you open next read the recent sessions of the one you used before, in the same repo, through MCP.',
  },
  {
    group: 'What it is',
    q: 'Does it summarise sessions or keep a memory?',
    a: 'No. It points agents at the raw transcript messages, which stay the source of truth. There is no generated summary and no durable memory to curate.',
  },
  {
    group: 'What it is',
    q: 'Which agents are supported?',
    a: 'Claude Code, Codex, Cursor, GitHub Copilot in VS Code, GitHub Copilot CLI, Google Antigravity, and opencode.',
  },
  {
    group: 'Setup',
    q: 'Do I need to run setup in every project?',
    a: 'Once per project you want handoff in. The plugin makes the tools reachable everywhere, but a project that has not opted in has no index, so every tool says so and names npx -y xtctx setup. Setup also writes managed instruction blocks, which put the handoff in front of the next agent whether it calls a tool or not.',
    aHtml:
      'Once per project you want handoff in. The plugin makes the tools reachable everywhere, but a project that has not opted in has no index, so every tool says so and names <code>npx -y xtctx setup</code>. Setup also writes managed instruction blocks, which put the handoff in front of the next agent whether it calls a tool or not.',
  },
  {
    group: 'Setup',
    q: 'Does xtctx run a background service?',
    a: 'No. There is no daemon, API server, dashboard or watcher. Each MCP client (Claude Code, Codex, Cursor and the rest) starts its own xtctx MCP server, which indexes when it starts and when it is called, and stops when the client exits.',
  },
  {
    group: 'Setup',
    q: 'Can I try it without my own transcripts?',
    a: 'Yes. The public demo smoke creates synthetic Claude Code and Codex transcripts in a temporary project, then calls the built MCP server over stdio.',
    aHtml:
      'Yes. The <a href="https://github.com/fstubner/xtctx/blob/main/docs/demo.md">public demo smoke</a> creates synthetic Claude Code and Codex transcripts in a temporary project, then calls the built MCP server over stdio.',
  },
  {
    group: 'Data',
    q: 'Where does data live?',
    a: 'Project config is .xtctx/config.yaml and the index is .xtctx/state/xtctx.db, both in the project. The index can be deleted and rebuilt. Transcripts stay wherever each agent keeps them.',
    aHtml:
      'Project config is <code>.xtctx/config.yaml</code> and the index is <code>.xtctx/state/xtctx.db</code>, both in the project. The index can be deleted and rebuilt. Transcripts stay wherever each agent keeps them.',
  },
  {
    group: 'Data',
    q: 'Does anything leave my machine?',
    a: 'Not by default. Search uses a local embedding model. A project can point xtctx at a remote OpenAI-compatible embedding endpoint instead, which sends transcript text to it; that has to be configured by hand.',
  },
  {
    group: 'Data',
    q: 'What are the limits?',
    a: 'Agents change their transcript formats without notice, so xtctx reports records it does not recognise rather than guessing. Semantic vectors build in the background, and search falls back to keyword until they exist or when the local model is unavailable.',
  },
  {
    group: 'Data',
    q: 'Is it open source?',
    a: 'Yes. xtctx is MIT licensed and published at github.com/fstubner/xtctx.',
    aHtml:
      'Yes. xtctx is MIT licensed and published at <a href="https://github.com/fstubner/xtctx">github.com/fstubner/xtctx</a>.',
  },
];
