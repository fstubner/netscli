import { defineConfig } from 'astro/config';

// Canonical site URL. Used by Astro for absolute URL generation in
// sitemap/RSS integrations if we add them later, and surfaces in the
// generated HTML via the built-in `Astro.site` global.
export default defineConfig({
  site: 'https://netscli.com',
  // Minify the output. Default in Astro 5 but explicit here for clarity.
  build: {
    inlineStylesheets: 'auto',
  },
});
