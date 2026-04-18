// All project-specific content lives here. Fork the site and this is
// the one file you edit to retarget it at a different product. Every
// component reads from this module.

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
}

export interface InstallEntry {
  label: string;
  /** Shell command(s) shown monospace with copy button. */
  command: string;
  /** Optional small hint under the command. HTML allowed. */
  hint?: string;
}

export interface FaqItem {
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
    entries: InstallEntry[];
    tryCommands: string[];
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
      'netscli — Rust network scanner with CLI, TUI, desktop app, and MCP server',
    description:
      'Open-source network scanner written in Rust. Discover hosts, scan ports, resolve DNS, and capture packets from a CLI, a terminal UI, a desktop app, or an MCP server that your AI agent can call directly. Free, MIT-licensed, runs on Windows, Linux, and macOS.',
    ogDescription:
      'Open-source network scanner. Discover hosts, scan ports, resolve DNS. Four interfaces, one Rust library. Includes an MCP server so AI agents can query your network directly.',
    keywords:
      'network scanner, rust, cli, tui, mcp server, model context protocol, port scan, host discovery, dns lookup, arp table, bonjour, mdns, packet capture, claude, cursor, ai agent, network tool, cross-platform',
    siteName: 'netscli',
    author: { name: 'Felix Stubner', url: 'https://github.com/fstubner' },
    ogImage: 'https://netscli.com/gui-dashboard.png',
    faviconPath: '/favicon.svg',
    themeColor: '#111',
  },

  branding: {
    wordmark: '/assets/netscli-wordmark.png',
    wordmarkAlt: 'netscli',
    accentGradient: 'linear-gradient(90deg,#059669,#0aae7a 50%,#1edcff)',
    bg: '#111',
    fg: '#d4d4d4',
  },

  hero: {
    badge: 'Open source · MIT · Rust · Windows, Linux, macOS',
    heading: 'A network scanner you can talk to',
    subhead:
      'Discover hosts, scan ports, resolve DNS, capture packets. Use it from a terminal, a desktop app, or let your AI agent call the MCP server or the CLI directly.',
    quickInstall:
      'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
    installLinkLabel: 'Windows & Cargo options ↓',
    heroImage: '/gui-dashboard.png',
    heroImageWebp: '/gui-dashboard.webp',
    heroImageAlt:
      "netscli desktop app dashboard on Windows showing the default network interface, live traffic rates, and a table of detected network interfaces",
    heroImageWidth: 1375,
    heroImageHeight: 1000,
    sourceUrl: 'https://github.com/fstubner/netscli',
  },

  copy: {
    surfaces: {
      heading: 'Four interfaces, one library',
      leadHtml:
        'Every surface calls the same <code>netscli-core</code>. <a href="https://github.com/fstubner/netscli#usage">Full docs →</a>',
    },
    install: {
      heading: 'Get started',
      leadHtml:
        'Install, then run. <a href="https://github.com/fstubner/netscli#readme">Full README →</a>',
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
        "A standalone desktop application for when you'd rather not open a terminal. Scan ports, discover hosts, look up DNS records, inspect your ARP table. Available for Windows, Linux, and macOS.",
      image: {
        src: '/gui-scan.png',
        webp: '/gui-scan.webp',
        alt:
          'netscli desktop app port scan view: scanning 1.1.1.1 for ports 80 and 443 returns both as open with http and https service labels',
        width: 1375,
        height: 1000,
      },
    },
    {
      title: 'Terminal UI',
      body:
        'An interactive terminal interface. Type <code>/</code> to see available commands, use tab to autocomplete, arrow keys to browse history. The status bar shows your IP and live traffic rates.',
      image: {
        src: '/assets/tui-discover.png',
        webp: '/assets/tui-discover.webp',
        alt:
          'netscli terminal UI running /discover: list of live hosts on the local subnet with IP addresses, hostnames, and response times',
        width: 1200,
        height: 680,
      },
      flip: true,
    },
    {
      title: 'Command line',
      body:
        'Every scan ships as a standalone subcommand with <code>--json</code> and <code>--yaml</code> output. Pipe results into jq, call it from a shell script, or have an agent invoke it directly without the full MCP server.',
      codeHtml: `<span style="color:#888">$</span> netscli scan 1.1.1.1 -p 80,443 --json
<span style="color:#555">[</span>
  <span style="color:#555">{</span> <span style="color:#7c9fc7">"port"</span>: 80,  <span style="color:#7c9fc7">"open"</span>: true, <span style="color:#7c9fc7">"service"</span>: <span style="color:#8fbc7f">"http"</span>  <span style="color:#555">}</span>,
  <span style="color:#555">{</span> <span style="color:#7c9fc7">"port"</span>: 443, <span style="color:#7c9fc7">"open"</span>: true, <span style="color:#7c9fc7">"service"</span>: <span style="color:#8fbc7f">"https"</span> <span style="color:#555">}</span>
<span style="color:#555">]</span>

<span style="color:#888">$</span> netscli discover --json | jq '.[].ip'
<span style="color:#8fbc7f">"192.168.1.10"</span>
<span style="color:#8fbc7f">"192.168.1.21"</span>
<span style="color:#8fbc7f">"192.168.1.57"</span>`,
    },
    {
      title: 'MCP server',
      body:
        'Run <code>netscli serve</code> and point Claude Desktop or Cursor at it. Your agent gets 10 tools — host discovery, port scanning, DNS, ARP, mDNS, and more — over standard JSON-RPC.',
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
    entries: [
      {
        label: 'Homebrew (macOS + Linux)',
        command: 'brew tap fstubner/tap && brew install netscli',
        hint:
          'Installs the prebuilt binary, shell completions, and man page in one step.',
      },
      {
        label: 'Scoop (Windows)',
        command:
          'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli',
        hint: 'Auto-updates on <code>scoop update</code>.',
      },
      {
        label: 'Cargo',
        command: 'cargo install netscli',
        hint:
          "Cross-platform if you have the Rust toolchain. Reproducible and easy to update.",
      },
      {
        label: 'Linux / macOS script',
        command:
          'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
        hint: 'Add <code>NETSCLI_PCAP=1</code> for packet capture.',
      },
      {
        label: 'Windows PowerShell script',
        command:
          'iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex',
        hint: 'Add <code>$env:NETSCLI_PCAP=1</code> for packet capture.',
      },
    ],
    tryCommands: [
      'netscli discover',
      'netscli scan 192.168.1.1 -p 22,80,443',
      'netscli dns google.com',
      'netscli serve',
      'netscli --help',
    ],
    binariesNote:
      'Or grab binaries from <a href="https://github.com/fstubner/netscli/releases/latest" style="color:#ccc;text-decoration:underline;text-underline-offset:3px">the latest release</a>.',
  },

  faq: [
    {
      q: 'What is netscli?',
      a: 'netscli is an open-source network scanner written in Rust. It discovers hosts on a subnet, scans TCP ports, resolves DNS (including mDNS/Bonjour), reads the ARP table with vendor lookup, and optionally captures packets via libpcap/Npcap. The same functionality is available from a command line, a terminal UI with autocomplete, a desktop app, or a Model Context Protocol (MCP) server that AI agents like Claude Code and Cursor can call directly.',
      aHtml:
        'netscli is an open-source network scanner written in Rust. It discovers hosts on a subnet, scans TCP ports, resolves DNS (including mDNS/Bonjour), reads the ARP table with vendor lookup, and optionally captures packets via libpcap or Npcap. The same functionality is available from a command line, a <a href="#surfaces">terminal UI</a> with autocomplete, a desktop app, or a Model Context Protocol (MCP) server that AI agents like Claude Code and Cursor can call directly.',
    },
    {
      q: 'How do I install netscli?',
      a: 'On Linux or macOS run: curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash. On Windows run: iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex. With Rust installed you can also run: cargo install netscli. Prebuilt binaries for Windows, Linux (x86_64/aarch64/musl), and macOS (x86_64/aarch64) are attached to every GitHub release.',
      aHtml:
        'On Linux or macOS: <code>curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash</code>. On Windows: <code>iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex</code>. With Rust installed you can also run <code>cargo install netscli</code>. Prebuilt binaries for Windows, Linux (x86_64/aarch64/musl), and macOS (x86_64/aarch64) are attached to every <a href="https://github.com/fstubner/netscli/releases/latest">GitHub release</a>.',
    },
    {
      q: 'Can I use netscli with Claude Code, Cursor, or another AI agent?',
      a: 'Yes. Running `netscli serve` starts a Model Context Protocol (MCP) server over stdio exposing ten tools: discover_network, scan_ports, ping_host, dns_lookup, get_arp_table, inspect_host, sweep_network, list_network_interfaces, discover_mdns, and capture_pcap. Point your MCP client at the netscli binary and your agent can query the local network with structured JSON responses, no parsing required.',
      aHtml:
        'Yes. Running <code>netscli serve</code> starts a Model Context Protocol (MCP) server over stdio, exposing ten tools: <code>discover_network</code>, <code>scan_ports</code>, <code>ping_host</code>, <code>dns_lookup</code>, <code>get_arp_table</code>, <code>inspect_host</code>, <code>sweep_network</code>, <code>list_network_interfaces</code>, <code>discover_mdns</code>, and <code>capture_pcap</code>. Point your MCP client at the <code>netscli</code> binary and your agent can query the local network with structured JSON responses, no parsing required.',
    },
    {
      q: 'Does netscli work on Windows, macOS, and Linux?',
      a: 'Yes. Every release ships binaries for Windows x86_64, Linux x86_64 (glibc and musl), Linux aarch64, macOS x86_64, and macOS aarch64, with and without packet-capture support. The desktop app is built for Windows (.exe/.msi), macOS (.app bundle), and Linux (.AppImage/.deb).',
      aHtml:
        'Yes. Every release ships binaries for Windows <code>x86_64</code>, Linux <code>x86_64</code> (glibc and musl), Linux <code>aarch64</code>, macOS <code>x86_64</code>, and macOS <code>aarch64</code>, with and without packet-capture support. The desktop app is built for Windows (<code>.exe</code>/<code>.msi</code>), macOS (<code>.app</code> bundle), and Linux (<code>.AppImage</code>/<code>.deb</code>).',
    },
    {
      q: 'Is netscli open source?',
      a: 'Yes. netscli is MIT-licensed. Source, issue tracker, and releases are at https://github.com/fstubner/netscli. The library (netscli-core) and MCP server (netscli-mcp) are published to crates.io so other Rust projects can build on them.',
      aHtml:
        'Yes. netscli is MIT-licensed. Source, issue tracker, and releases are at <a href="https://github.com/fstubner/netscli">github.com/fstubner/netscli</a>. The library (<a href="https://crates.io/crates/netscli-core">netscli-core</a>) and MCP server (<a href="https://crates.io/crates/netscli-mcp">netscli-mcp</a>) are published to crates.io so other Rust projects can build on them.',
    },
    {
      q: 'Does netscli require libpcap or other system dependencies?',
      a: 'Not for the default build. Host discovery, port scan, DNS, and ARP inspection all work with zero non-Rust runtime dependencies. Packet capture is a feature-gated extra that requires libpcap (Linux/macOS) or Npcap (Windows) at runtime. The install script installs the right library for you when you pass NETSCLI_PCAP=1.',
      aHtml:
        'Not for the default build. Host discovery, port scan, DNS, ARP, and mDNS discovery all work with zero non-Rust runtime dependencies. Packet capture is a feature-gated extra that needs libpcap (Linux/macOS) or Npcap (Windows) at runtime. The install script installs the right library for you when you pass <code>NETSCLI_PCAP=1</code>.',
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

  version: '0.2.0',
};
