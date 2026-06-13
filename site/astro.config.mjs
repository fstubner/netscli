import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Canonical site URL. Used by Astro for absolute URL generation in
// sitemap/RSS integrations if we add them later, and surfaces in the
// generated HTML via the built-in `Astro.site` global.
export default defineConfig({
  site: 'https://netscli.com',
  integrations: [
    starlight({
      title: 'NetsCLI docs',
      description:
        'Technical documentation for NetsCLI, a Rust-based network scanner and diagnostics toolkit with a desktop app, terminal UI, CLI, MCP server, and shared core library.',
      disable404Route: true,
      logo: {
        src: './public/assets/netscli-wordmark.png',
        replacesTitle: true,
      },
      components: {
        Header: './src/components/starlight/Header.astro',
        Footer: './src/components/starlight/Footer.astro',
        MobileMenuFooter: './src/components/starlight/MobileMenuFooter.astro',
      },
      customCss: ['./src/styles/starlight.css'],
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
