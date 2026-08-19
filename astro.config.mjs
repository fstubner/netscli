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
        MarkdownContent: './src/components/starlight/MarkdownContent.astro',
      },
      // Split from a single 4,965-line starlight.css into ordered per-pass
      // files (see docs/ARCHITECTURE.md). Order matters: several later
      // files intentionally override earlier ones at equal specificity, so
      // this array must stay in the same relative order as the original
      // file — do not alphabetize or reorder without checking the affected
      // rules' cascade dependency first.
      customCss: [
        './src/styles/tokens.css',
        './src/styles/starlight/01-tokens-and-header.css',
        './src/styles/starlight/02-search-and-sidebar-base.css',
        './src/styles/starlight/03-shell-layout-base.css',
        './src/styles/starlight/04-markdown-content-base.css',
        './src/styles/starlight/05-docs-surfaces.css',
        './src/styles/starlight/06-docs-interaction-a.css',
        './src/styles/starlight/07-docs-interaction-b.css',
        './src/styles/starlight/08-search-modal.css',
        './src/styles/starlight/09-search-table-fit.css',
        './src/styles/starlight/10-docs-feedback.css',
        './src/styles/starlight/11-docs-chrome-consistency.css',
        './src/styles/starlight/12-docs-toc-responsive.css',
        './src/styles/starlight/13-docs-rail-alignment.css',
        './src/styles/starlight/14-docs-nav-table.css',
        './src/styles/starlight/15-responsive-containment.css',
        './src/styles/starlight/16-shell-interaction-closeout.css',
        './src/styles/starlight/17-mobile-shell-closeout-a.css',
        './src/styles/starlight/18-mobile-shell-closeout-b.css',
        './src/styles/starlight/19-markdown-tables.css',
        './src/styles/starlight/20-docs-shell-closeout.css',
        './src/styles/starlight/21-mobile-docs-shell-verified.css',
        './src/styles/starlight/22-mobile-docs-correction.css',
        './src/styles/starlight/23-regression-guardrails.css',
        './src/styles/starlight/24-mobile-regression-guardrails.css',
        './src/styles/starlight/25-mobile-overrides-final.css',
        './src/styles/starlight/26-mobile-containment.css',
        './src/styles/starlight/27-release-qa-overrides.css',
        './src/styles/starlight/28-final-interaction-guardrails.css',
        // Loads last on purpose: it has to outrank the `!important` colour
        // declarations several earlier files make on `.sl-markdown-content a`
        // and `code`. See the file for why that is unavoidable today.
        './src/styles/starlight/29-callout-contrast.css',
        './src/styles/starlight/30-toc-under-hero.css',
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
