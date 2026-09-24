import type { Modules } from './types';

// Whole sections of the site, on or off. `docs: false` takes the Starlight
// integration out of the build as well as the links to it -- astro.config.mjs
// reads this file -- so a product without documentation builds three routes
// and needs no config edit. The docs sources can then be deleted; the README
// lists which directories.
export const modules: Modules = {
  docs: true,
  changelog: true,
};
