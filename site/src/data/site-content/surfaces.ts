import type { SectionCopy, SurfaceCard } from './types';

export const surfacesCopy: SectionCopy = {
  heading: 'Choose how to work with your network',
  leadHtml:
    'Use the desktop app for review, the terminal UI for live sessions, the CLI for scripts, and MCP for agent workflows. They all call the same Rust core, so results stay consistent no matter which interface you choose. <a href="/docs/">Full docs →</a>',
};

export const surfaces: SurfaceCard[] = [
  {
    title: 'Desktop app',
    body:
      'Use the desktop app when you want tabs, sortable tables, filters, row details, history, and exports. It is the best interface for comparing results across scans, discovery, DNS, route checks, local inventory, and packet capture in builds that include packet-capture support.',
    image: {
      src: '/gui-scan.png',
      webp: '/gui-scan.webp',
      alt:
        'NetsCLI Desktop dark theme scan view showing sanitized demo port results, row details, command preview, and status bar',
      width: 1377,
      height: 862,
    },
  },
  {
    title: 'Terminal UI',
    body:
      'Run <code>netscli</code> with no subcommand to start the terminal UI. Use it when you want an interactive session without leaving the terminal, with command history, autocomplete, readable status colors, and local interface activity close to the current investigation.',
    image: {
      src: '/assets/tui-discover.png',
      webp: '/assets/tui-discover.webp',
      alt:
        'netscli terminal UI running /discover with sanitized lab hostnames, vendors, and response times',
      width: 1640,
      height: 930,
    },
    flip: true,
  },
  {
    title: 'Command line',
    body:
      'Use the CLI for repeatable diagnostics and automation. Network operations expose <code>--json</code> and <code>--yaml</code> output, so scripts and other tools can consume the same data the desktop app displays.',
    codeHtml: `<span style="color:#888">$</span> netscli scan demo.local -p 80,443 --json
<span style="color:#7b7b7b">[</span>
  <span style="color:#7b7b7b">{</span> <span style="color:#7c9fc7">"port"</span>: 80,  <span style="color:#7c9fc7">"open"</span>: true, <span style="color:#7c9fc7">"service"</span>: <span style="color:#8fbc7f">"http"</span>  <span style="color:#7b7b7b">}</span>,
  <span style="color:#7b7b7b">{</span> <span style="color:#7c9fc7">"port"</span>: 443, <span style="color:#7c9fc7">"open"</span>: true, <span style="color:#7c9fc7">"service"</span>: <span style="color:#8fbc7f">"https"</span> <span style="color:#7b7b7b">}</span>
<span style="color:#7b7b7b">]</span>

<span style="color:#888">$</span> netscli discover --json | jq '.[].hostname'
<span style="color:#8fbc7f">"workstation.local"</span>
<span style="color:#8fbc7f">"phone.local"</span>
<span style="color:#8fbc7f">"pi.local"</span>`,
  },
  {
    title: 'MCP server',
    body:
      'Run <code>netscli serve</code> when an MCP client needs local network tools. The server exposes structured operations for discovery, scanning, ping, DNS, ARP, inspect, sweep, interfaces, and mDNS, with packet-capture tools available in packet-capture builds.',
    codeHtml: `<span style="color:#888">// claude_desktop_config.json</span>
<span style="color:#7b7b7b">{</span>
  <span style="color:#7c9fc7">"mcpServers"</span>: <span style="color:#7b7b7b">{</span>
    <span style="color:#7c9fc7">"netscli"</span>: <span style="color:#7b7b7b">{</span>
      <span style="color:#7c9fc7">"command"</span>: <span style="color:#8fbc7f">"netscli"</span>,
      <span style="color:#7c9fc7">"args"</span>: [<span style="color:#8fbc7f">"serve"</span>]
    <span style="color:#7b7b7b">}</span>
  <span style="color:#7b7b7b">}</span>
<span style="color:#7b7b7b">}</span>`,
    flip: true,
  },
];
