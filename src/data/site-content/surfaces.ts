import type { SectionCopy, SurfaceCard } from './types';

export const surfacesCopy: SectionCopy = {
  heading: 'Two ways to use it',
  leadHtml:
    'One card per surface your product has. Cards alternate sides down the page; set <code>flip</code> to start on the right.',
};

export const surfaces: SurfaceCard[] = [
  {
    title: 'In the terminal',
    body: 'A card with an image panel. Give the intrinsic width and height so the browser reserves the space before the file arrives, and write alt text that says what the picture shows.',
    image: {
      src: '/assets/hero.png',
      alt: 'The Example command-line tool running in a terminal',
      width: 1640,
      height: 930,
    },
  },
  {
    title: 'In a script',
    body: 'A card with a code panel instead of an image. The markup is yours; colour it with the shared code tokens so it follows the theme.',
    flip: true,
    codeHtml: `<span style="color:var(--ui-code-comment)">$</span> example run --json
{
  <span style="color:var(--ui-code-key)">"status"</span>: <span style="color:var(--ui-code-string)">"ok"</span>,
  <span style="color:var(--ui-code-key)">"items"</span>: <span style="color:var(--ui-code-punct)">12</span>
}`,
  },
  {
    title: 'In an agent',
    body: 'A card with an agent-session visual: the project, one file open, and the chat in which a coding agent calls your tool. Set <code>visual</code> on any card, or on the hero, to use any visual kind.',
    // The tool calls and their results are claims about what your product
    // returns, and a reader takes them for a capture. Run the session for
    // real and paste what came back; edit only by removing lines. The same
    // rule as terminal.ts, for the same reason.
    visual: {
      kind: 'agent-session',
      session: {
        title: 'example-project',
        files: ['src/main.ts', 'src/report.ts', 'AGENTS.md', 'package.json'],
        open: {
          path: 'AGENTS.md',
          text: `# Agent notes

Use the example tool for reports:

- example_run returns the latest report as JSON.
- example_status says whether it is configured.
`,
          highlight: ['example_run', 'example_status'],
        },
        turns: [
          { role: 'user', text: 'What did the last report say?' },
          { role: 'agent', text: 'AGENTS.md says to use example_run for reports.' },
          { role: 'tool', call: 'example_run(format: "json")', result: ['{ "status": "ok", "items": 12 }'] },
          { role: 'agent', text: 'The last report was ok, with 12 items.' },
        ],
      },
    },
  },
];
