import type { DocsSection } from './types';

// The docs section's own copy and structure. Starlight reads these from
// astro.config.mjs; they live here because a product's docs are content.
//
// Nothing checks that a `link` resolves: Starlight builds an entry pointing
// at a page that does not exist without complaining, so an entry left behind
// after deleting its page becomes a dead link in every page's sidebar.
// Source landing has no Starlight docs title/sidebar; titles use siteName only.
export const docsTitle = 'xtctx docs';

export const docsDescription =
  'xtctx writes local MCP config and managed instructions so AI coding tools can read recent transcript sessions from the current repo.';

export const docsLogo = './public/assets/wordmark.png';

export const docsSidebar: DocsSection[] = [
  {
    label: 'Start',
    items: [
      { label: 'Overview', link: '/docs/' },
      { label: 'Installation', link: '/docs/install/' },
    ],
  },
  {
    label: 'Reference',
    items: [{ label: 'Commands', link: '/docs/commands/' }],
  },
];
