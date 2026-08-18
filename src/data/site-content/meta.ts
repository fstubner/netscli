import type { Branding, Meta } from './types';

export const meta: Meta = {
  domain: 'https://netscli.com',
  // "Modern" and "Diagnostics Toolkit" were spending 30 of the ~60 characters
  // a search result shows on words nobody searches for. The interfaces are the
  // differentiator, and MCP is the one term here with real intent behind it
  // and almost no competition.
  title: 'NetsCLI — Network Scanner for Desktop, CLI, and MCP',
  // 153 characters. The previous one ran to 172 and was cut around 158, which
  // truncated the MCP mention off the end -- the most valuable word in it. It
  // also ran operations and interfaces through a single "for" series
  // ("a scanner for ... packet capture, and desktop, terminal, CLI, and MCP
  // workflows"), which does not parse cleanly.
  description:
    'Discover LAN devices, scan TCP ports, query DNS, and trace routes from a desktop app, terminal UI, CLI, or MCP server. One Rust core, consistent results.',
  // Same scoping as the hero subhead: capture is not in any published desktop
  // installer, so this must not imply it ships with the app. It is what search
  // results and link previews show, which is where an inaccurate claim travels
  // furthest.
  ogDescription:
    'Discover LAN devices, scan TCP ports, query DNS, trace routes, and inspect hosts from the desktop app, terminal UI, CLI, or MCP server backed by one Rust core. Packet capture in capture-enabled CLI builds.',
  siteName: 'NetsCLI',
  author: { name: 'Felix Stubner', url: 'https://github.com/fstubner' },
  ogImage: 'https://netscli.com/assets/tui-discover.png',
  faviconPath: '/favicon.svg',
  themeColor: '#111',
};

export const branding: Branding = {
  wordmark: '/assets/netscli-wordmark.png',
  wordmarkAlt: 'NetsCLI',
  accentGradient: 'linear-gradient(90deg,#16a34a,#22c55e 50%,#1edcff)',
  bg: '#111',
  fg: '#d4d4d4',
};
