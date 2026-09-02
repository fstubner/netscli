import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Canonical site URL. Used by Astro for absolute URL generation in
// sitemap/RSS integrations if we add them later, and surfaces in the
// generated HTML via the built-in `Astro.site` global.
export default defineConfig({
  site: 'https://netscli.com',
  integrations: [
    starlight({
      // Starlight renders the docs pages with its own layout, not
      // src/layouts/Page.astro, so the noindex that layout emits for a
      // preview build does not reach them. Inject it here too, or a
      // preview deploy leaves 11 of 14 pages crawlable.
      head: [
        // Starlight emits `twitter:card: summary_large_image` on every docs
        // page but supplies no image, so sharing a docs link produced a card
        // that declared a large image and had none. The landing page and the
        // changelog set theirs in Page.astro; these are the same asset.
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://netscli.com/assets/tui-discover.png' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://netscli.com/assets/tui-discover.png' } },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image:alt',
            content: 'netscli terminal UI running /discover with sanitized lab hostnames, vendors, and response times',
          },
        },
        ...(process.env.NETSCLI_PREVIEW === '1'
          ? [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }]
          : []),
      ],
      title: 'NetsCLI docs',
      // "network scanner", not "network scanner and diagnostics toolkit" --
      // one name for the product, matching the title, H1 and description on
      // the landing page.
      description:
        'Technical documentation for NetsCLI, a Rust-based network scanner with a desktop app, terminal UI, CLI, MCP server, and shared core library.',
      disable404Route: true,
      logo: {
        src: './public/assets/netscli-wordmark.png',
        replacesTitle: true,
      },
      components: {
        Header: './src/components/starlight/Header.astro',
        Footer: './src/components/starlight/Footer.astro',
        MobileMenuFooter: './src/components/starlight/MobileMenuFooter.astro',
        PageSidebar: './src/components/starlight/PageSidebar.astro',
      },
      // One file per region of the docs shell. None uses !important (the five
      // token remaps in code.css excepted, for inline styles): Starlight's own
      // CSS is in @layer, so plain rules outrank it. Order matters in two
      // places only, and each file says so at the top: search-input.css
      // before search.css, and tables.css before tables-narrow.css. To
      // re-theme, edit docs/theme.css; to change a region, edit its file.
      // scripts/css-regions.mjs and css-shadowing.mjs hold this shape.
      customCss: [
        './src/styles/tokens.css',
        './src/styles/docs/theme.css',
        './src/styles/docs/base.css',
        './src/styles/docs/shell.css',
        './src/styles/docs/header.css',
        './src/styles/docs/header-controls.css',
        './src/styles/docs/sidebar.css',
        './src/styles/docs/toc.css',
        './src/styles/docs/toc-bar.css',
        './src/styles/docs/content.css',
        './src/styles/docs/code.css',
        './src/styles/docs/tables.css',
        './src/styles/docs/tables-narrow.css',
        './src/styles/docs/search-input.css',
        './src/styles/docs/search.css',
        './src/styles/docs/search-results.css',
        // The theme select, shared with the landing bar, which imports the
        // same file in Page.astro. Last on purpose: it is the control's
        // definition rather than an override of one, and it has to outrank
        // Starlight's own scoped styles for that component. See the file.
        './src/styles/theme-control.css',
        './src/styles/code-surface.css',
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/fstubner/netscli',
        },
      ],
      sidebar: [
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
      ],
    }),
  ],
  build: {
    // Force-inline the Astro-generated CSS. Our full stylesheet is ~3 KiB
    // gzipped — smaller than the round-trip cost of a render-blocking
    // <link rel="stylesheet">. Lighthouse flagged this as a LCP cost;
    // 'always' replaces the <link> with a <style> in <head>.
    inlineStylesheets: 'always',
  },
});
