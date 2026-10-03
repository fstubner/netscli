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
    a: 'Switching coding agents mid-task usually means re-explaining the work. xtctx lets the next agent read the last one’s recent sessions in the same repo, over MCP.',
  },
  {
    group: 'What it is',
    q: 'Does it summarise sessions or keep a memory?',
    a: 'No. Agents read the raw transcript messages, which stay the source of truth. xtctx generates no summary and keeps no memory.',
  },
  {
    group: 'What it is',
    q: 'Which agents are supported?',
    a: 'Claude Code, Codex, Cursor, GitHub Copilot in VS Code, GitHub Copilot CLI, Google Antigravity, and opencode.',
  },
  {
    group: 'Setup',
    q: 'Do I need to run setup in every project?',
    a: 'Yes, once per project: run npx -y xtctx setup. The plugin makes the tools reachable everywhere, but a project that has not been set up has no index, and every tool says so.',
    aHtml:
      'Yes, once per project: run <code>npx -y xtctx setup</code>. The plugin makes the tools reachable everywhere, but a project that has not been set up has no index, and every tool says so.',
  },
  {
    group: 'Setup',
    q: 'Does xtctx run a background service?',
    a: 'No. Each MCP client starts its own xtctx MCP server, which indexes when it starts and when it is called, and stops when the client exits. There is no daemon, API server, dashboard or watcher.',
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
    a: 'Config is .xtctx/config.yaml and the index is .xtctx/state/xtctx.db, both in the project. Transcripts stay where each agent keeps them. Claude Code deletes transcripts older than 30 days by default, and then the index is the only copy of those sessions, so back it up with xtctx export.',
    aHtml:
      'Config is <code>.xtctx/config.yaml</code> and the index is <code>.xtctx/state/xtctx.db</code>, both in the project. Transcripts stay where each agent keeps them. Claude Code deletes transcripts older than 30 days by default, and then the index is the only copy of those sessions, so back it up with <code>xtctx export</code>.',
  },
  {
    group: 'Data',
    q: 'Does anything leave my machine?',
    a: 'Not by default. Search runs on this machine. Two opt-ins send transcript text elsewhere: a remote OpenAI-compatible embedding endpoint set in a project’s config, and cloud sync, which uploads a project only after you run xtctx login and xtctx sync enable.',
    aHtml:
      'Not by default. Search runs on this machine. Two opt-ins send transcript text elsewhere: a remote OpenAI-compatible embedding endpoint set in a project’s config, and <a href="https://github.com/fstubner/xtctx/blob/main/docs/cloud-sync.md">cloud sync</a>, which uploads a project only after you run <code>xtctx login</code> and <code>xtctx sync enable</code>.',
  },
  {
    group: 'Data',
    q: 'What are the limits?',
    a: 'Agents change their transcript formats without notice, so xtctx reports records it does not recognise instead of guessing. Search is keyword-only until you add semantic search (xtctx embeddings enable, about 540 MB), and it falls back to keyword while vectors are missing.',
    aHtml:
      'Agents change their transcript formats without notice, so xtctx reports records it does not recognise instead of guessing. Search is keyword-only until you add semantic search (<code>xtctx embeddings enable</code>, about 540 MB), and it falls back to keyword while vectors are missing.',
  },
  {
    group: 'Data',
    q: 'Is it open source?',
    a: 'Yes. xtctx is MIT licensed and published at github.com/fstubner/xtctx.',
    aHtml:
      'Yes. xtctx is MIT licensed and published at <a href="https://github.com/fstubner/xtctx">github.com/fstubner/xtctx</a>.',
  },
];
