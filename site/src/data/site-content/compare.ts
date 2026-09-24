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
//
// Remote actions (RDP, Radmin, shutdown, Wake-on-LAN) were a row on
// 2026-09-24 and went into the note instead: they are remote management, not
// scanning, the one row comparing a different kind of thing.
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

// Only rows that tell the tools apart. Platforms-by-name, command line,
// desktop app and TCP ports were rows on 2026-09-24 and came out: most tools
// ticked them, so they took space without giving anyone a reason to choose.
export const compareRows: ComparisonRow[] = [
  { feature: 'Windows, macOS and Linux', cells: ['✓', '✓', '✓', 'Windows only'] },
  // NetsCLI's CLI, TUI and MCP server are one binary; the desktop app is a
  // separate download on the same core.
  { feature: 'Command line, terminal UI and desktop app', cells: ['All three', 'CLI and Zenmap', 'GUI and CLI', 'GUI, undocumented console'] },
  { feature: 'AI agents (MCP server)', cells: ['✓', '—', '—', '—'] },
  // nmap writes XML (and normal/grepable text) but no JSON. Angry IP Scanner
  // exports CSV, TXT, XML, IP:port lists and SQL; Advanced IP Scanner CSV,
  // XML and HTML. Neither has JSON.
  { feature: 'JSON output for scripts', cells: ['✓', 'XML only', '—', '—'] },
  // nmap resolves targets and does reverse DNS built in; other record types
  // come from specific NSE scripts (dns-srv-enum and others), not a general
  // lookup.
  { feature: 'DNS record lookups', cells: ['✓', 'Via scripts', '—', '—'] },
  // nmap: broadcast-dns-service-discovery. Angry IP Scanner queries mDNS only
  // to name a local host when reverse DNS has no answer.
  { feature: 'mDNS / Bonjour devices', cells: ['✓', 'Via script', 'Hostnames only', '—'] },
  // Advanced IP Scanner is free, but no source code or licence text is
  // published anywhere official.
  { feature: 'Open source', cells: ['MIT', 'NPSL', 'GPLv2', '—'] },
  // There because NetsCLI loses it: this is why people pick nmap, and a table
  // without it would be an advert.
  { feature: 'UDP, OS and version detection', cells: ['—', '✓', '—', '—'] },
];

/** Shown under the table: where the other tools are the better choice. */
export const compareNoteHtml =
  'nmap is the deeper tool for audits and security work, with SYN and UDP scans, service and OS detection, and over 600 scripts. Advanced IP Scanner is built around acting on the Windows machines it finds: RDP and Radmin sessions, remote shutdown and Wake-on-LAN.';
