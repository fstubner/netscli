import type { Hero, HeroCommands, HeroDownload } from './types';

export const hero: Hero = {
  badge: 'Local · MCP · Seven coding agents',
  heading: 'Switch coding agents without re-explaining the work.',
  subhead:
    'xtctx indexes the transcripts your coding agents already write and serves them over MCP, so the next agent you open can read what the last one did. By default nothing leaves your machine.',
  // The same two commands on every platform: the plugin reaches every project,
  // setup opts one in.
  quickInstall: 'claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx',
  quickInstallAlt: 'npx -y xtctx setup',
  installLinkLabel: 'Other agents and setup',
  // Rendered from terminal.ts by `npm run assets:terminal`.
  heroImage: '/assets/hero.png',
  heroImageAlt: 'xtctx status in a terminal, listing indexed sessions per coding agent',
  heroImageWidth: 1200,
  heroImageHeight: 462,
  sourceUrl: 'https://github.com/fstubner/xtctx',
  // No desktop build; heroDownloads is empty, so neither is rendered.
  downloadLabel: '',
  downloadMenuLabel: '',
};

const commands = {
  packageManager: 'npx -y xtctx setup',
  script: 'claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx',
};

// Not OS-specific: the plugin and npx commands are the same everywhere.
export const heroCommands: HeroCommands = {
  windows: commands,
  macos: commands,
  linux: commands,
};

export const heroDownloads: HeroDownload[] = [];
