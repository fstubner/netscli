import type { Analytics, BuiltWithEntry, SocialProof } from './types';

// The "Built with" row in the footer. Credit what the product is made of,
// not what the site is made of.
export const builtWith: BuiltWithEntry[] = [
  { name: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/' },
  { name: 'SQLite', url: 'https://www.sqlite.org/' },
  { name: 'Astro', url: 'https://astro.build/' },
];

// Star and download counts are fetched from this repo at runtime. A repo
// that does not exist simply leaves the counters hidden.
export const social: SocialProof = { repo: 'fstubner/xtctx' };

// No analytics token: the beacon is left out of every build. Add
// `cloudflareToken` to turn it on.
export const analytics: Analytics = {};
