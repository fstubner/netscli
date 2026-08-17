import type { Hero } from './types';

export const hero: Hero = {
  // Platforms only. "Open source" and "MIT" repeat in the footer and the
  // FAQ, and "Rust" is in the subhead one line below ("the same Rust core"),
  // so the badge was spending four items to deliver one piece of new
  // information. The platform list is the part a visitor cannot get anywhere
  // else above the fold.
  badge: 'Windows · Linux · macOS',
  heading: 'A modern network scanner',
  subhead:
    // Packet capture is scoped deliberately. Listing it alongside the other
    // operations claimed it works "from the desktop app, terminal UI, CLI, or
    // MCP server", and no published desktop installer has capture compiled in
    // at all -- a visitor could install from this page, go looking for it, and
    // find nothing. The capture-enabled CLI assets are real and published, so
    // the feature stays on the page; it just no longer implies the download
    // above it includes it.
    'Discover LAN devices, scan TCP ports, query DNS, trace routes, and inspect hosts from the desktop app, terminal UI, CLI, or MCP server — with packet capture in capture-enabled CLI builds. Each interface calls the same Rust core, so results stay consistent.',
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
