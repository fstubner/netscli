import type { AppSchema, Branding, Meta } from './types';

export const meta: Meta = {
  domain: 'https://xtctx.com',
  // Aim for a title under about 60 characters: that is what a search result
  // shows. Lead with the product name, then what it is, in the words someone
  // would actually search for.
  title: 'xtctx — Cross-tool handoff for AI coding agents',
  // 150-160 characters. Longer gets truncated mid-sentence, and the end of
  // the sentence is usually the part worth reading.
  description:
    'xtctx indexes the transcripts your AI coding agents already write and serves them over MCP, so the next agent you open can pick up where the last one stopped.',
  // Shown when the page is shared, where there is a little more room.
  ogDescription:
    'Local transcript retrieval over MCP for Claude Code, Codex, Cursor, Copilot, Antigravity and opencode.',
  siteName: 'xtctx',
  author: { name: 'Felix Stubner', url: 'https://github.com/fstubner' },
  ogImage: 'https://xtctx.com/assets/hero.png',
  ogImageAlt: 'xtctx status in a terminal, listing indexed sessions per coding agent',
  faviconPath: '/favicon.svg',
  themeColor: '#0a1424',
};

// Facts about the PRODUCT for the JSON-LD, not about this site.
export const appSchema: AppSchema = {
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'MCP server',
  operatingSystem: 'Windows, macOS, Linux',
  license: 'https://opensource.org/licenses/MIT',
  programmingLanguage: 'TypeScript',
  price: '0',
  priceCurrency: 'USD',
};

export const branding: Branding = {
  // Both built by `npm run assets:wordmark` from public/mark.svg and
  // `siteName` above. The two differ only in the colour of the lettering:
  // light for the dark bar, near-black for the light one.
  wordmark: '/assets/wordmark.png',
  wordmarkLight: '/assets/wordmark-light.png',
  wordmarkAlt: 'xtctx',
  accentGradient: 'linear-gradient(90deg,#e8dfc8,#e8b878)',
  bg: '#0a1424',
  fg: '#e8dfc8',
};
