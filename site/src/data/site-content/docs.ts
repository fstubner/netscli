import type { DocsSection } from './types';

// The docs section's own copy and structure. Starlight reads these from
// astro.config.mjs; they live here because a product's docs are content, and
// retargeting the site should not mean editing build config.
//
// Nothing checks that a `link` resolves: Starlight builds an entry pointing
// at a page that does not exist without complaining, so an entry left behind
// after deleting its page becomes a dead link in the sidebar of every page.
export const docsTitle = 'NetsCLI docs';

// "network scanner", not "network scanner and diagnostics toolkit" -- one
// name for the product, matching the title, H1 and description on the
// landing page.
export const docsDescription =
  'Technical documentation for NetsCLI, a Rust-based network scanner with a desktop app, terminal UI, CLI, MCP server, and shared core library.';

export const docsLogo = './public/assets/netscli-wordmark.png';

export const docsSidebar: DocsSection[] = [
  {
    label: 'Start',
    items: [
      { label: 'Overview', link: '/docs/' },
      { label: 'Installation', link: '/docs/install/' },
      { label: 'Interface coverage', link: '/docs/interface-coverage/' },
    ],
  },
  {
    label: 'Interfaces',
    items: [
      { label: 'Desktop app', link: '/docs/desktop/' },
      { label: 'Terminal UI', link: '/docs/tui/' },
      { label: 'CLI', link: '/docs/cli/' },
      { label: 'MCP server', link: '/docs/mcp/' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Operation guide', link: '/docs/operations/' },
      { label: 'Packet capture', link: '/docs/packet-capture/' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'Core library and crates', link: '/docs/core-library/' },
      { label: 'Result model', link: '/docs/result-model/' },
    ],
  },
];
