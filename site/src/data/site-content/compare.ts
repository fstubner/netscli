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
// Re-checked on 2026-10-07. All three versions are still the latest. Three
// nmap cells changed, because a dash or a tick in them said more than nmap's own
// pages do: the MCP server, Wake-on-LAN and Open source rows (see each).
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
// goes further than netscli's partial answers; add-ons (nmap,
// Angry IP Scanner); remote actions (Advanced IP Scanner); and "Open source",
// a tick for NetsCLI and Angry IP Scanner, and words for nmap (see the row).
// Rows every tool ticks (desktop app, naming devices by MAC vendor) are left
// out: they tell nobody anything.
export const compareRows: ComparisonRow[] = [
  { feature: 'Windows, macOS and Linux', cells: ['✓', '✓', '✓', 'Windows only'] },
  // Advanced IP Scanner installs a console exe that Famatech confirms but has
  // never documented.
  { feature: 'Command line', cells: ['✓', '✓', '✓', 'Undocumented'] },
  { feature: 'Terminal UI', cells: ['✓', '—', '—', '—'] },
  // nmap ships no MCP server, but other people have written several and they
  // are easy to find, so its cell says third-party rather than a dash that reads
  // as "none exist". Angry IP Scanner and Advanced IP Scanner have none that we
  // could find.
  { feature: 'AI agents (MCP server)', cells: ['✓', 'Third-party only', '—', '—'] },
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
  // have no extension point. "Add-ons", not "Plugins or scripts": the
  // latter read as "can't be scripted", and NetsCLI is driven from scripts
  // through --json and the MCP server (the Command line and AI agents rows).
  { feature: 'Add-ons (plugins, scripts)', cells: ['—', '✓', '✓', '—'] },
  // Record queries, not hostnames: all four name hosts by reverse DNS, so a
  // row that read as "resolves hostnames" would be wrong for the others.
  // nmap queries other record types and DNS-SD only from specific NSE
  // scripts. Angry IP Scanner asks mDNS only to name a local host.
  { feature: 'DNS record and mDNS queries', cells: ['✓', 'Via scripts', '—', '—'] },
  // nmap's NSE script broadcast-wake-on-lan sends a Wake-on-LAN packet, so a dash
  // would be wrong for that third of the row. nmap has nothing for remote
  // desktop or shutdown, hence "only".
  { feature: 'Remote desktop, shutdown, Wake-on-LAN', cells: ['—', 'Wake-on-LAN only, via a script', '—', '✓'] },
  // No output-format row. A "JSON output" row went to NetsCLI alone, but
  // nmap writes XML, Angry IP Scanner CSV, XML, text and SQL, and Advanced
  // IP Scanner CSV, XML and HTML: every tool has a machine-readable export,
  // so singling out JSON read as a gotcha.
  // nmap calls itself "free and open source", under its own Nmap Public Source
  // License. nmap.org/npsl says it believes the license meets the Open Source
  // Definition but has not been through the OSI's certification, so a tick would
  // claim more than nmap does. Angry IP Scanner is GPL-2.0. Advanced IP Scanner
  // publishes no source code or license text.
  { feature: 'Open source', cells: ['✓', 'Source available', '✓', '—'] },
];

// When and against what, because every cell goes stale as the other tools
// release. Keep the versions in step with the header comment when rechecking.
export const compareNoteHtml =
  'Compared in October 2026 against NetsCLI 0.3.4, <a href="https://nmap.org/changelog.html">nmap 7.991</a>, <a href="https://angryip.org/">Angry IP Scanner 3.10.0</a> and <a href="https://www.advanced-ip-scanner.com/">Advanced IP Scanner 2.5</a>. nmap\'s license is not certified by the Open Source Initiative, so its Open source cell reads Source available. Spot something wrong? <a href="https://github.com/fstubner/netscli/issues/new">Open an issue</a>.';
