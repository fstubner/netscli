import { defineConfig } from 'astro/config';

// Canonical site URL. Used by Astro for absolute URL generation in
// sitemap/RSS integrations if we add them later, and surfaces in the
// generated HTML via the built-in `Astro.site` global.
export default defineConfig({
  site: 'https://netscli.com',
  build: {
    // Force-inline the Astro-generated CSS. Our full stylesheet is ~3 KiB
    // gzipped — smaller than the round-trip cost of a render-blocking
    // <link rel="stylesheet">. Lighthouse flagged this as a LCP cost;
    // 'always' replaces the <link> with a <style> in <head>.
    inlineStylesheets: 'always',
  },
});
