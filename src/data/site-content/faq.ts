import type { FaqItem, SectionCopy } from './types';

export const faqCopy: SectionCopy = {
  heading: 'FAQ',
  leadHtml: 'The questions people actually ask before installing.',
};

// Note: `a` (plain text) is embedded verbatim into JSON-LD structured data
// (see layouts/Page.astro) and must stay real prose — for entries whose
// `aHtml` contains structural markup (command lists, not just inline tags),
// deriving `a` from `aHtml` mechanically would produce garbled JSON-LD, so
// both fields are authored explicitly rather than derived.
export const faq: FaqItem[] = [
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
];
