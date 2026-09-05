import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { meta } from './src/data/site-content/meta';
import { social } from './src/data/site-content/footer';
import {
  docsDescription,
  docsLogo,
  docsSidebar,
  docsTitle,
} from './src/data/site-content/docs';

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
        { tag: 'meta', attrs: { property: 'og:image', content: meta.ogImage } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: meta.ogImage } },
        { tag: 'meta', attrs: { name: 'twitter:image:alt', content: meta.ogImageAlt } },
        ...(process.env.NETSCLI_PREVIEW === '1'
          ? [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }]
          : []),
      ],
      // Title, description, logo and sidebar come from
      // src/data/site-content/docs.ts with the rest of the site's content.
      title: docsTitle,
      description: docsDescription,
      disable404Route: true,
      logo: {
        src: docsLogo,
        replacesTitle: true,
      },
      components: {
        Header: './src/components/starlight/Header.astro',
        Footer: './src/components/starlight/Footer.astro',
        MobileMenuFooter: './src/components/starlight/MobileMenuFooter.astro',
        PageSidebar: './src/components/starlight/PageSidebar.astro',
        // Upstream's is a native <select>; its dropdown is drawn by the OS
        // and cannot be styled or positioned. See ThemeControl.astro.
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
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
          href: `https://github.com/${social.repo}`,
        },
      ],
      sidebar: docsSidebar,
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
