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
      height: 740,
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
    codeHtml: `<span style="color:var(--netscli-code-comment)">$</span> netscli scan demo.local -p 80,443 --json
<span style="color:var(--netscli-code-punct)">[</span>
  <span style="color:var(--netscli-code-punct)">{</span> <span style="color:var(--netscli-code-key)">"port"</span>: 80,  <span style="color:var(--netscli-code-key)">"open"</span>: true, <span style="color:var(--netscli-code-key)">"service"</span>: <span style="color:var(--netscli-code-string)">"http"</span>  <span style="color:var(--netscli-code-punct)">}</span>,
  <span style="color:var(--netscli-code-punct)">{</span> <span style="color:var(--netscli-code-key)">"port"</span>: 443, <span style="color:var(--netscli-code-key)">"open"</span>: true, <span style="color:var(--netscli-code-key)">"service"</span>: <span style="color:var(--netscli-code-string)">"https"</span> <span style="color:var(--netscli-code-punct)">}</span>
<span style="color:var(--netscli-code-punct)">]</span>

<span style="color:var(--netscli-code-comment)">$</span> netscli discover --json | jq '.[].hostname'
<span style="color:var(--netscli-code-string)">"workstation.local"</span>
<span style="color:var(--netscli-code-string)">"phone.local"</span>
<span style="color:var(--netscli-code-string)">"pi.local"</span>`,
  },
  {
    title: 'MCP server',
    body:
      'Run <code>netscli serve</code> when an MCP client needs local network tools. Discovery, scanning, ping, DNS, ARP and interfaces are all exposed as structured tools, so an agent gets the same results you would, in a shape it can parse.',
    codeHtml: `<span style="color:var(--netscli-code-comment)">// claude_desktop_config.json</span>
<span style="color:var(--netscli-code-punct)">{</span>
  <span style="color:var(--netscli-code-key)">"mcpServers"</span>: <span style="color:var(--netscli-code-punct)">{</span>
    <span style="color:var(--netscli-code-key)">"netscli"</span>: <span style="color:var(--netscli-code-punct)">{</span>
      <span style="color:var(--netscli-code-key)">"command"</span>: <span style="color:var(--netscli-code-string)">"netscli"</span>,
      <span style="color:var(--netscli-code-key)">"args"</span>: [<span style="color:var(--netscli-code-string)">"serve"</span>]
    <span style="color:var(--netscli-code-punct)">}</span>
  <span style="color:var(--netscli-code-punct)">}</span>
<span style="color:var(--netscli-code-punct)">}</span>`,
    flip: true,
  },
];
