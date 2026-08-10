import type { Branding, Meta } from './types';

export const meta: Meta = {
  domain: 'https://netscli.com',
  title: 'NetsCLI - Modern Network Scanner and Diagnostics Toolkit',
  description:
    'NetsCLI is a Rust-based network scanner for LAN discovery, TCP port scans, DNS, trace routes, host inspection, packet capture, and desktop, terminal, CLI, and MCP workflows.',
  ogDescription:
    'Discover LAN devices, scan TCP ports, query DNS, trace routes, inspect hosts, and capture packets from the desktop app, terminal UI, CLI, or MCP server backed by one Rust core.',
  keywords:
    'network scanner, rust, cli, tui, mcp server, model context protocol, port scan, host discovery, dns lookup, arp table, bonjour, mdns, packet capture, claude, cursor, ai agent, network tool, cross-platform',
  siteName: 'NetsCLI',
  author: { name: 'Felix Stubner', url: 'https://github.com/fstubner' },
  ogImage: 'https://netscli.com/assets/tui-discover.png',
  faviconPath: '/favicon.svg',
  themeColor: '#111',
};

export const branding: Branding = {
  wordmark: '/assets/netscli-wordmark.png',
  wordmarkAlt: 'NetsCLI',
  accentGradient: 'linear-gradient(90deg,#059669,#0aae7a 50%,#1edcff)',
  bg: '#111',
  fg: '#d4d4d4',
};
