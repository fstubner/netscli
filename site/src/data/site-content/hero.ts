import type { Hero } from './types';

export const hero: Hero = {
  badge: 'Open source · MIT · Rust · Windows, Linux, macOS',
  heading: 'A modern network scanner',
  subhead:
    'Discover LAN devices, scan TCP ports, query DNS, trace routes, inspect hosts, and capture packets from the desktop app, terminal UI, CLI, or MCP server. Each interface calls the same Rust core, so results stay consistent.',
  quickInstall:
    'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
  installLinkLabel: 'More install options ↓',
  heroImage: '/assets/tui-discover.png',
  heroImageWebp: '/assets/tui-discover.webp',
  heroImageAlt:
    'netscli terminal UI running /discover with sanitized lab hostnames, vendors, and response times',
  heroImageWidth: 1640,
  heroImageHeight: 930,
  sourceUrl: 'https://github.com/fstubner/netscli',
};
