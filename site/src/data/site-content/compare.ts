import type { ComparisonColumn, ComparisonRow, SectionCopy } from './types';

// The comparison matrix. Every cell describes what ships, out of the box.
//
// Checked on 2026-09-24 against each project's own website, documentation and
// source: nmap 7.991 (nmap.org changelog, reference guide, NSE index), Angry IP
// Scanner 3.10.0 (angryip.org, the GitHub release and the source), Advanced IP
// Scanner 2.5.4594.1 (advanced-ip-scanner.com, its help pages, and Famatech's
// replies on radmin-club.com). NetsCLI's column was checked against this
// repository's code, not against the site copy.
//
// A dash means the tool's own documentation and source show no such feature.
// Where a feature exists but is undocumented -- Advanced IP Scanner's console
// version, which Famatech confirms but never describes -- the cell says so
// rather than guessing either way.

export const compareCopy: SectionCopy = {
  heading: 'How NetsCLI compares',
  // No lead. One that listed what was compared and which versions said
  // nothing a reader needs before the table; the dates and versions are in
  // the comment above, where the next person to recheck the cells needs them.
  leadHtml: '',
};

export const compareColumns: ComparisonColumn[] = [
  { name: 'NetsCLI', highlight: true },
  { name: 'nmap' },
  { name: 'Angry IP Scanner' },
  { name: 'Advanced IP Scanner' },
];

// One row per question someone choosing a network scanner asks, in the order
// they ask it. An earlier cut (2026-09-24) kept only rows netscli won -- MCP,
// JSON, DNS records, mDNS -- and read as narrow and cherry-picked. Here every
// tool gets its strengths credited: nmap owns "Open ports" and "Going
// deeper", Advanced IP Scanner's remote actions are under "Tools built in".
export const compareRows: ComparisonRow[] = [
  { feature: 'Windows, macOS and Linux', cells: ['✓', '✓', '✓', 'Windows only'] },
  // NetsCLI's CLI, TUI and MCP server are one binary; the desktop app is a
  // separate download on the same core. Advanced IP Scanner also installs an
  // undocumented console exe; Famatech has never said what it does.
  { feature: 'Ways to use it', cells: ['CLI, terminal UI, desktop app, AI agents', 'CLI, desktop app (Zenmap)', 'Desktop app, CLI', 'Desktop app'] },
  // nmap: ARP/ND by default on a local network, plus ICMP, TCP SYN/ACK, UDP,
  // SCTP and IP-protocol pings. Angry IP Scanner: six pingers, ARP added
  // alongside on a LAN since 3.8.2. Advanced IP Scanner never says how.
  { feature: 'Finding devices', cells: ['ICMP or TCP probe, plus the ARP table', 'ARP, ICMP, TCP, UDP and more', 'ICMP, UDP, TCP, ARP', 'Not documented'] },
  // NetsCLI on Windows can also get a name over LLMNR/NetBIOS (it asks
  // `ping -a`), but that hasn't been observed end to end, so it isn't
  // claimed. nmap's NetBIOS names come from the nbstat script.
  { feature: 'Naming devices', cells: ['Reverse DNS, mDNS, MAC vendor', 'Reverse DNS, MAC vendor; NetBIOS via script', 'Reverse DNS, mDNS, NetBIOS, MAC vendor', 'NetBIOS, MAC vendor'] },
  // Advanced IP Scanner's docs cover checks for HTTP, HTTPS, FTP, RDP, Radmin
  // and shared folders; Famatech sells port scanning as Advanced Port Scanner.
  { feature: 'Open ports', cells: ['TCP, with banners and HTTP/TLS details', 'TCP and UDP, with service versions', 'TCP', 'Common services only'] },
  { feature: 'Going deeper', cells: ['—', 'OS detection, 600+ scripts', 'Plugins', '—'] },
  // NetsCLI's packet capture is left out: only the separate -pcap builds have
  // it. nmap's Ncat, Nping and Ndiff are separate tools in its suite. Angry IP
  // Scanner's "openers" launch the system's own tools against a host.
  { feature: 'Tools built in', cells: ['DNS lookups, ping, traceroute, ARP table', 'Traceroute', 'Opens system tools', 'RDP, remote shutdown, Wake-on-LAN'] },
  // NetsCLI: JSON/YAML/CSV/Markdown from the CLI, JSON/CSV from the desktop
  // app. nmap has no JSON. Angry IP Scanner also writes IP:port lists.
  { feature: 'Getting results out', cells: ['JSON, YAML, CSV, Markdown', 'XML, text', 'CSV, XML, text, SQL', 'CSV, XML, HTML'] },
  // Advanced IP Scanner publishes no source code or licence text.
  { feature: 'Price and source', cells: ['Free, MIT', 'Free, NPSL', 'Free, GPLv2', 'Free, no source published'] },
];

// No note: the rows now say where each of the others is stronger, which is
// all the note under the earlier table was for.
export const compareNoteHtml = '';
