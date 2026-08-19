import type { SectionCopy, SurfaceCard } from './types';

export const surfacesCopy: SectionCopy = {
  heading: 'Choose how to work with your network',
  leadHtml:
    'Four ways in, one engine behind them. Whichever you pick — desktop app, terminal UI, CLI or MCP — a port scan means the same thing and returns the same answer. <a href="/docs/">Full docs →</a>',
};

export const surfaces: SurfaceCard[] = [
  {
    title: 'Desktop app',
    body:
      'The desktop app is where you compare results side by side. Tabs keep several investigations open at once, and every result is sortable, filterable, and exportable, with the full history kept as you go.',
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
      'Run <code>netscli</code> with no subcommand to start the terminal UI. It is the one to reach for when you are already in a shell and want to stay there — history and autocomplete included, with local interface activity beside the results.',
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
      'Run <code>netscli serve</code> when an MCP client needs local network tools. Every operation the CLI has is exposed as a structured tool, so an agent gets the same discovery, scanning and DNS results you would, in a shape it can parse.',
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
