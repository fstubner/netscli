import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// All project-specific content lives here. Fork the site and this is
// the one file you edit to retarget it at a different product. Every
// component reads from this module.

function readProductVersion(): string {
  const packagePath = [
    join(process.cwd(), '..', 'apps', 'netscli-gui', 'package.json'),
    join(process.cwd(), 'apps', 'netscli-gui', 'package.json'),
  ].find((candidate) => existsSync(candidate));
  if (!packagePath) return '0.0.0';
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
  return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
}

const productVersion = readProductVersion();

export interface Meta {
  /** Canonical site URL without trailing slash. */
  domain: string;
  /** <title> */
  title: string;
  /** <meta name="description"> */
  description: string;
  /** Short form used in OG / Twitter cards. Falls back to description. */
  ogDescription?: string;
  /** Comma-separated keyword list. */
  keywords: string;
  /** Site name for OG. */
  siteName: string;
  author: { name: string; url: string };
  /** Absolute URL to the OG/Twitter share image. */
  ogImage: string;
  /** Favicon + apple-touch-icon. */
  faviconPath: string;
  themeColor: string;
}

export interface Branding {
  /** Path to the wordmark image served from /. */
  wordmark: string;
  /** Shown in nav at 160px desktop / 132px mobile. */
  wordmarkAlt: string;
  /** Links + underline accent colour. */
  accentGradient: string;
  /** Background fill. */
  bg: string;
  /** Default body text colour. */
  fg: string;
}

export interface Hero {
  /** Small uppercase strip above the headline. */
  badge: string;
  heading: string;
  subhead: string;
  /** Shell command shown in the hero's highlighted install block. */
  quickInstall: string;
  /** Jump-to-install link label. */
  installLinkLabel: string;
  /** Path to the hero screenshot. */
  heroImage: string;
  heroImageAlt: string;
  /** Intrinsic pixel dimensions so the browser reserves layout space. */
  heroImageWidth: number;
  heroImageHeight: number;
  /** Optional WebP source for <picture>. */
  heroImageWebp?: string;
  /** Link to the source repo for the "View source" pill. */
  sourceUrl: string;
}

export interface SurfaceCard {
  title: string;
  /** HTML allowed — typically short paragraph, may contain <code>. */
  body: string;
  /** If set, renders an image panel. */
  image?: {
    src: string;
    webp?: string;
    alt: string;
    width: number;
    height: number;
  };
  /** If set instead of image, renders a stylised code block. HTML allowed. */
  codeHtml?: string;
  /** If true, flips text and visual sides for alternating rhythm. */
  flip?: boolean;
  /** Optional per-platform download buttons rendered below the body.
   *  Used by the Desktop card to surface .msi / .dmg / .deb / .AppImage
   *  installers from the latest GitHub release. */
  downloads?: SurfaceDownload[];
}

export interface SurfaceDownload {
  /** Visible button label, e.g. "Windows (.msi)". */
  label: string;
  /** Direct download URL. Use the /releases/latest/download/ form so
   *  the buttons auto-track the latest release without site updates. */
  url: string;
  /** Optional secondary line below the label, e.g. "Apple Silicon". */
  hint?: string;
}

export type Platform = 'windows' | 'macos' | 'linux';

export interface InstallEntry {
  label: string;
  /** Shell command(s) shown monospace with copy button. */
  command: string;
  /** Optional small hint. NOT rendered in the current OS-tabbed design;
   *  kept on the type for possible future variants or SEO copy. */
  hint?: string;
}

export interface TryCommand {
  /** Short comment rendered above the command. */
  comment: string;
  /** Shell command copied by the row-level copy button. */
  command: string;
}

export interface FaqItem {
  group: string;
  q: string;
  /** Plain text used verbatim in both the visible section and JSON-LD. */
  a: string;
  /** Rich HTML variant for the visible section. Falls back to `a`. */
  aHtml?: string;
}

export interface BuiltWithEntry {
  name: string;
  url: string;
}

export interface SocialProof {
  /** GitHub repo in "owner/name" format. Used to fetch stars + download counts. */
  repo: string;
}

export interface Analytics {
  /** Cloudflare Web Analytics beacon token. Omit to disable. */
  cloudflareToken?: string;
}

export interface SectionCopy {
  heading: string;
  /** HTML allowed — typically short tagline with an anchor link. */
  leadHtml: string;
}

export interface SiteData {
  meta: Meta;
  branding: Branding;
  hero: Hero;
  /** Visible headings + leads for each main section. */
  copy: {
    surfaces: SectionCopy;
    install: SectionCopy;
    faq: SectionCopy;
  };
  surfaces: SurfaceCard[];
  install: {
    /** Per-OS arrays. Position 0 is the recommended (hero) entry; the
     *  rest render as alternative rows below it in array order. */
    byPlatform: Record<Platform, InstallEntry[]>;
    tryCommands: TryCommand[];
    binariesNote: string;
  };
  faq: FaqItem[];
  builtWith: BuiltWithEntry[];
  social: SocialProof;
  analytics: Analytics;
  /** Version string published on crates.io / used in structured data. */
  version: string;
}

export const site: SiteData = {
  meta: {
    domain: 'https://netscli.com',
    title:
      'NetsCLI - Modern Network Scanner and Diagnostics Toolkit',
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
  },

  branding: {
    wordmark: '/assets/netscli-wordmark.png',
    wordmarkAlt: 'NetsCLI',
    accentGradient: 'linear-gradient(90deg,#059669,#0aae7a 50%,#1edcff)',
    bg: '#111',
    fg: '#d4d4d4',
  },

  hero: {
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
  },

  copy: {
    surfaces: {
      heading: 'Choose how to work with your network',
      leadHtml:
        'Use the desktop app for review, the terminal UI for live sessions, the CLI for scripts, and MCP for agent workflows. They all call the same Rust core, so results stay consistent no matter which interface you choose. <a href="/docs/">Full docs →</a>',
    },
    install: {
      heading: 'Get started',
      leadHtml:
        'Install NetsCLI, then run a scan or lookup from the desktop app, TUI, or CLI. <a href="/docs/">Full docs →</a>',
    },
    faq: {
      heading: 'FAQ',
      leadHtml: 'The questions people actually ask before installing.',
    },
  },

  surfaces: [
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
<span style="color:#555">[</span>
  <span style="color:#555">{</span> <span style="color:#7c9fc7">"port"</span>: 80,  <span style="color:#7c9fc7">"open"</span>: true, <span style="color:#7c9fc7">"service"</span>: <span style="color:#8fbc7f">"http"</span>  <span style="color:#555">}</span>,
  <span style="color:#555">{</span> <span style="color:#7c9fc7">"port"</span>: 443, <span style="color:#7c9fc7">"open"</span>: true, <span style="color:#7c9fc7">"service"</span>: <span style="color:#8fbc7f">"https"</span> <span style="color:#555">}</span>
<span style="color:#555">]</span>

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
<span style="color:#555">{</span>
  <span style="color:#7c9fc7">"mcpServers"</span>: <span style="color:#555">{</span>
    <span style="color:#7c9fc7">"netscli"</span>: <span style="color:#555">{</span>
      <span style="color:#7c9fc7">"command"</span>: <span style="color:#8fbc7f">"netscli"</span>,
      <span style="color:#7c9fc7">"args"</span>: [<span style="color:#8fbc7f">"serve"</span>]
    <span style="color:#555">}</span>
  <span style="color:#555">}</span>
<span style="color:#555">}</span>`,
      flip: true,
    },
  ],

  install: {
    byPlatform: {
      windows: [
        {
          label: 'Winget',
          command: 'winget install fstubner.netscli',
        },
        {
          label: 'Scoop',
          command:
            'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli',
        },
        {
          label: 'PowerShell script',
          command:
            'iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex',
        },
        {
          label: 'Cargo',
          command: 'cargo install netscli',
        },
      ],
      macos: [
        {
          label: 'Homebrew',
          command: 'brew tap fstubner/tap && brew install netscli',
        },
        {
          label: 'Install script',
          command:
            'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
        },
        {
          label: 'Cargo',
          command: 'cargo install netscli',
        },
      ],
      linux: [
        {
          label: 'Install script',
          command:
            'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
        },
        {
          label: 'AUR (Arch)',
          command: 'yay -S netscli-bin',
        },
        {
          label: 'Homebrew',
          command: 'brew tap fstubner/tap && brew install netscli',
        },
        {
          label: 'Cargo',
          command: 'cargo install netscli',
        },
      ],
    },
    tryCommands: [
      {
        comment: 'Find live hosts on your current network',
        command: 'netscli discover',
      },
      {
        comment: 'Open the interactive terminal UI',
        command: 'netscli',
      },
      {
        comment: 'Check common TCP services on a router or host',
        command: 'netscli scan router.local -p 22,80,443',
      },
      {
        comment: 'Resolve DNS records with structured output available',
        command: 'netscli dns google.com',
      },
      {
        comment: 'Expose NetsCLI tools to Claude, Cursor, and other MCP clients',
        command: 'netscli serve',
      },
      {
        comment: 'List every CLI command and option',
        command: 'netscli --help',
      },
    ],
    binariesNote:
      'Or grab CLI binaries and desktop installers (<code>.msi</code> / <code>.dmg</code> / <code>.deb</code> / <code>.AppImage</code>) from <a href="https://github.com/fstubner/netscli/releases/latest">the latest release</a>.',
  },

  faq: [
    {
      group: 'What it is',
      q: 'What is NetsCLI?',
      a: 'NetsCLI is an open-source network scanner and diagnostics toolkit written in Rust. It discovers hosts on a subnet, scans TCP ports, queries DNS, traces routes, reads local interfaces and the ARP neighbor cache, and can capture packets when packet-capture support and the required system library are available. You can use it from the desktop app, terminal UI, CLI, or Model Context Protocol (MCP) server.',
      aHtml:
        'NetsCLI is an open-source network scanner and diagnostics toolkit written in Rust. It discovers hosts on a subnet, scans TCP ports, queries DNS, traces routes, reads local interfaces and the ARP neighbor cache, and can capture packets when packet-capture support and the required system library are available. You can use it from the desktop app, <a href="#surfaces">terminal UI</a>, CLI, or Model Context Protocol (MCP) server.',
    },
    {
      group: 'Install and updates',
      q: 'How do I install NetsCLI?',
      a: 'Install the netscli package for the CLI, terminal UI, and MCP server. On Windows, run: winget install fstubner.netscli. On Linux or macOS, run: curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash. For the Windows desktop app, run: winget install fstubner.netscli.gui. With Rust installed you can also run: cargo install netscli. Prebuilt binaries and desktop installers are attached to GitHub releases when available for that platform.',
      aHtml: `
        <p>Install the <code>netscli</code> package for the CLI, terminal UI, and MCP server:</p>
        <div class="faq-command-list" aria-label="Install commands">
          <div class="faq-command"><span>Windows</span><code>winget install fstubner.netscli</code></div>
          <div class="faq-command"><span>Linux/macOS</span><code>curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash</code></div>
          <div class="faq-command"><span>Rust</span><code>cargo install netscli</code></div>
        </div>
        <p>Install the Windows desktop app separately:</p>
        <div class="faq-command-list" aria-label="Desktop app install command">
          <div class="faq-command"><span>Windows app</span><code>winget install fstubner.netscli.gui</code></div>
        </div>
        <p>Prebuilt binaries and desktop installers for Windows, Linux, and macOS are attached to <a href="https://github.com/fstubner/netscli/releases/latest">GitHub releases</a> when available for that platform.</p>
      `,
    },
    {
      group: 'Interfaces and integrations',
      q: 'Can I use NetsCLI with Claude Code, Cursor, or another AI agent?',
      a: 'Yes. Running `netscli serve` starts a Model Context Protocol (MCP) server over stdio. It exposes structured local-network tools for host discovery, port scanning, ping, DNS, ARP, host inspection, network sweep, interface listing, and mDNS discovery. Packet-capture builds can also expose capture tools. Packet capture uses a job-style flow for long-running work: start the capture, poll status, then fetch the result.',
      aHtml:
        'Yes. Running <code>netscli serve</code> starts a Model Context Protocol (MCP) server over stdio. It exposes structured local-network tools for host discovery, port scanning, ping, DNS, ARP, host inspection, network sweep, interface listing, and mDNS discovery. Packet-capture builds can also expose capture tools. Packet capture uses a job-style flow for long-running work: start the capture, poll status, then fetch the result.',
    },
    {
      group: 'Install and updates',
      q: 'Does NetsCLI work on Windows, macOS, and Linux?',
      a: 'Yes. Release artifacts target Windows, macOS, and Linux. CLI/TUI binaries are published for common x86_64 and aarch64 targets, including macOS Intel and Apple Silicon. The desktop app is published as Windows, macOS, and Linux installers where the release workflow supports that platform.',
      aHtml:
        'Yes. Release artifacts target Windows, macOS, and Linux. CLI/TUI binaries are published for common <code>x86_64</code> and <code>aarch64</code> targets, including macOS Intel and Apple Silicon. The desktop app is published as Windows, macOS, and Linux installers where the release workflow supports that platform.',
    },
    {
      group: 'What it is',
      q: 'Is NetsCLI open source?',
      a: 'Yes. NetsCLI is MIT-licensed. Source, issue tracker, and releases are at https://github.com/fstubner/netscli. The library (netscli-core) and MCP server (netscli-mcp) are published to crates.io so other Rust projects can build on them.',
      aHtml:
        'Yes. NetsCLI is MIT-licensed. Source, issue tracker, and releases are at <a href="https://github.com/fstubner/netscli">github.com/fstubner/netscli</a>. The library (<a href="https://crates.io/crates/netscli-core">netscli-core</a>) and MCP server (<a href="https://crates.io/crates/netscli-mcp">netscli-mcp</a>) are published to crates.io so other Rust projects can build on them.',
    },
    {
      group: 'Limits and dependencies',
      q: 'Does NetsCLI require libpcap or other system dependencies?',
      a: 'Not for the normal scan, discovery, DNS, ARP, ping, trace, or interface workflows. Packet capture is the exception: it requires libpcap on Linux/macOS or Npcap on Windows at runtime, and only works in builds compiled with packet-capture support.',
      aHtml:
        'Not for the normal scan, discovery, DNS, ARP, ping, trace, or interface workflows. Packet capture is the exception: it requires libpcap on Linux/macOS or Npcap on Windows at runtime, and only works in builds compiled with packet-capture support.',
    },
    {
      group: 'Network workflows',
      q: 'Is NetsCLI an alternative to Angry IP Scanner or Advanced IP Scanner?',
      a: 'NetsCLI overlaps with those tools for common LAN discovery tasks: finding live hosts, scanning TCP ports, resolving hostnames, and showing MAC vendors from the local ARP cache. It is not a drop-in clone of either application. The main differences are cross-platform desktop app/TUI/CLI/MCP interfaces, structured JSON/YAML output, and an MIT-licensed Rust core.',
      aHtml:
        'NetsCLI overlaps with those tools for common LAN discovery tasks: finding live hosts, scanning TCP ports, resolving hostnames, and showing MAC vendors from the local ARP cache. It is not a drop-in clone of either application. The main differences are cross-platform desktop app/TUI/CLI/MCP interfaces, structured <code>--json</code>/<code>--yaml</code> output, and an MIT-licensed Rust core.',
    },
    {
      group: 'Network workflows',
      q: 'How do I find devices on my home network with NetsCLI?',
      a: 'Run `netscli discover` from a machine on the network, or pass a subnet explicitly with `netscli discover <subnet>`. NetsCLI probes the range, then adds reverse DNS, ARP cache data, MAC addresses, and OUI vendor names when the operating system has that information available.',
      aHtml: `
        <p>Run discovery from any machine on the network:</p>
        <div class="faq-command-list" aria-label="Discovery commands">
          <div class="faq-command"><span>Auto-detect</span><code>netscli discover</code></div>
          <div class="faq-command"><span>Specific subnet</span><code>netscli discover &lt;subnet&gt;</code></div>
        </div>
        <p>NetsCLI probes the range, then adds reverse DNS, ARP cache data, MAC addresses, and OUI vendor names when the operating system has that information available.</p>
      `,
    },
    {
      group: 'Install and updates',
      q: 'Is NetsCLI a free network scanner for Windows, macOS, or Linux?',
      a: 'Yes. NetsCLI is MIT-licensed and free for personal, open-source, and commercial use. Windows users can install the CLI/TUI with `winget install fstubner.netscli` and the desktop app with `winget install fstubner.netscli.gui`. macOS and Linux users can install through the script, Homebrew, Cargo, or packaged release artifacts.',
      aHtml: `
        <p>Yes. NetsCLI is MIT-licensed and free for personal, open-source, and commercial use.</p>
        <div class="faq-command-list" aria-label="Package manager commands">
          <div class="faq-command"><span>Windows CLI/TUI/MCP</span><code>winget install fstubner.netscli</code></div>
          <div class="faq-command"><span>Windows app</span><code>winget install fstubner.netscli.gui</code></div>
          <div class="faq-command"><span>Windows</span><code>scoop bucket add fstubner https://github.com/fstubner/scoop-bucket &amp;&amp; scoop install netscli</code></div>
          <div class="faq-command"><span>macOS</span><code>brew tap fstubner/tap &amp;&amp; brew install netscli</code></div>
          <div class="faq-command"><span>Linux</span><code>curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash</code></div>
          <div class="faq-command"><span>Arch Linux</span><code>yay -S netscli-bin</code></div>
        </div>
        <p>Packet capture is the only workflow that needs a system capture library: libpcap on Linux/macOS or Npcap on Windows. mDNS discovery is pure Rust and is included in the published app, CLI, and MCP builds.</p>
      `,
    },
    {
      group: 'Network workflows',
      q: 'Can NetsCLI replace nmap for simple network scans?',
      a: 'For host discovery, basic TCP port scans, DNS lookups, and ARP-table inspection on a local network, NetsCLI can cover the simpler cases with direct subcommands and structured output. For advanced service detection, NSE scripts, OS fingerprinting, and raw packet workflows, nmap remains the better tool.',
      aHtml:
        'For host discovery, basic TCP port scans, DNS lookups, and ARP-table inspection on a local network, NetsCLI can cover the simpler cases with direct subcommands and structured output. For advanced service detection, NSE scripts, OS fingerprinting, and raw packet workflows, nmap remains the better tool.',
    },
    {
      group: 'Network workflows',
      q: 'What is the difference between scan, inspect, discover, and sweep?',
      a: 'Use scan when you already know a host and want TCP port status. Use inspect when you want a host profile that combines reachability, reverse DNS, and optional port checks. Use discover to find reachable devices on a subnet. Use sweep when you want discovery plus open-port checks across the discovered hosts.',
      aHtml:
        'Use <code>scan</code> when you already know a host and want TCP port status. Use <code>inspect</code> when you want a host profile that combines reachability, reverse DNS, and optional port checks. Use <code>discover</code> to find reachable devices on a subnet. Use <code>sweep</code> when you want discovery plus open-port checks across the discovered hosts.',
    },
    {
      group: 'Limits and dependencies',
      q: 'What does filtered mean in a port scan?',
      a: 'Filtered means NetsCLI could not complete the TCP connection before the timeout. In practice, the packet may have been dropped by a firewall, blocked by a router, or ignored by the host. It is different from closed, where the host actively refused the connection.',
      aHtml:
        '<code>filtered</code> means NetsCLI could not complete the TCP connection before the timeout. In practice, the packet may have been dropped by a firewall, blocked by a router, or ignored by the host. It is different from <code>closed</code>, where the host actively refused the connection.',
    },
  ],

  builtWith: [
    { name: 'Rust', url: 'https://www.rust-lang.org/' },
    { name: 'ratatui', url: 'https://ratatui.rs/' },
    { name: 'Tauri', url: 'https://tauri.app/' },
    { name: 'hickory', url: 'https://github.com/hickory-dns/hickory-dns' },
    { name: 'sqlx', url: 'https://github.com/launchbadge/sqlx' },
  ],

  social: { repo: 'fstubner/netscli' },

  analytics: {
    cloudflareToken: 'c03201f65f6d41aa843c81f259a1ac06',
  },

  version: productVersion,
};
