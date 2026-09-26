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

// Ticks, not phrases. A version with a short phrase in every cell (one row
// per question a buyer asks, 2026-09-24) was accurate and unreadable: too much
// to take in, nothing to scan. A tick table is only honest if some rows go to
// the other tools, so some do: service versions and OS detection, where nmap
// goes further than netscli's partial answers; plugins and scripts (nmap,
// Angry IP Scanner); remote actions (Advanced IP Scanner); and "Open source"
// is a tick for three of four.
// Rows every tool ticks (desktop app, naming devices by MAC vendor) are left
// out: they tell nobody anything.
export const compareRows: ComparisonRow[] = [
  { feature: 'Windows, macOS and Linux', cells: ['✓', '✓', '✓', 'Windows only'] },
  // Advanced IP Scanner installs a console exe that Famatech confirms but has
  // never documented.
  { feature: 'Command line', cells: ['✓', '✓', '✓', 'Undocumented'] },
  { feature: 'Terminal UI', cells: ['✓', '—', '—', '—'] },
  { feature: 'AI agents (MCP server)', cells: ['✓', '—', '—', '—'] },
  // NetsCLI and Angry IP Scanner do TCP connect scans. Advanced IP Scanner's
  // docs cover checks for HTTP, HTTPS, FTP, RDP, Radmin and shared folders;
  // Famatech sells port scanning as Advanced Port Scanner.
  { feature: 'TCP port scan', cells: ['✓', '✓', '✓', 'Some services'] },
  // UDP: NetsCLI probes DNS, NTP, NetBIOS, SSDP and mDNS with the request
  // each expects (#475). Angry IP Scanner can ping over UDP but scans only
  // TCP ports (PortsFetcher). Advanced IP Scanner documents no UDP.
  { feature: 'UDP port scan', cells: ['✓', '✓', '—', '—'] },
  // NetsCLI reads what SSH, web, FTP/mail and MySQL servers announce, and
  // asks Redis/Valkey and Memcached one read-only question (#474): the
  // common services, not nmap's -sV probe database. Angry IP Scanner's "Web
  // detect" fetcher reads the HTTP Server header only.
  { feature: 'Service versions', cells: ['Common services', '✓', 'Web servers only', '—'] },
  // nmap's -O fingerprints the TCP/IP stack with crafted packets (admin
  // rights). NetsCLI's inspect gives a labelled hint from SMB, banners, MAC
  // vendor and TTL instead (#476). Neither of the others tries.
  { feature: 'OS detection', cells: ['Hints', '✓', '—', '—'] },
  // nmap's NSE runs Lua scripts (hundreds ship with it, vulnerability checks
  // among them). Angry IP Scanner takes Java plugins that add fetchers and
  // feeders (angryip.org documentation). NetsCLI and Advanced IP Scanner
  // have no extension point.
  { feature: 'Plugins or scripts', cells: ['—', '✓', '✓', '—'] },
  // Record queries, not hostnames: all four name hosts by reverse DNS, so a
  // row that read as "resolves hostnames" would be wrong for the others.
  // nmap queries other record types and DNS-SD only from specific NSE
  // scripts. Angry IP Scanner asks mDNS only to name a local host.
  { feature: 'DNS record and mDNS queries', cells: ['✓', 'Via scripts', '—', '—'] },
  { feature: 'Remote desktop, shutdown, Wake-on-LAN', cells: ['—', '—', '—', '✓'] },
  // No output-format row. A "JSON output" row went to NetsCLI alone, but
  // nmap writes XML, Angry IP Scanner CSV, XML, text and SQL, and Advanced
  // IP Scanner CSV, XML and HTML: every tool has a machine-readable export,
  // so singling out JSON read as a gotcha.
  // nmap calls itself "free and open source" (NPSL, source available).
  // Advanced IP Scanner publishes no source code or licence text.
  { feature: 'Open source', cells: ['✓', '✓', '✓', '—'] },
];

// When and against what, because every cell goes stale as the other tools
// release. Keep the versions in step with the header comment when rechecking.
export const compareNoteHtml =
  'Compared in September 2026 against NetsCLI 0.3.4, nmap 7.991, Angry IP Scanner 3.10.0 and Advanced IP Scanner 2.5. Spot something wrong? <a href="https://github.com/fstubner/netscli/issues/new">Open an issue</a>.';
