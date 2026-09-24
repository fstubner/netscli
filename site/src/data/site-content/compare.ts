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
// Rows are ordered by the question a reader is asking -- where it runs, how
// you use it, what it finds, what you get out -- rather than grouped under
// headings, so the template's component is used unchanged.
//
// Two rows are there because NetsCLI loses them. UDP, OS and version detection
// is the reason people pick nmap, and leaving it out would make the table an
// advert. Remote actions (RDP, Radmin, shutdown, Wake-on-LAN) were a row on
// 2026-09-24 and went into the note instead: they are remote management, not
// scanning, the one row comparing a different kind of thing.
export const compareCopy: SectionCopy = {
  heading: 'How NetsCLI compares',
  leadHtml:
    'Against the scanners people already use. Checked against each project’s own documentation and source on 24 September 2026: nmap 7.991, Angry IP Scanner 3.10.0 and Advanced IP Scanner 2.5.4594.1.',
};

export const compareColumns: ComparisonColumn[] = [
  { name: 'NetsCLI', highlight: true },
  { name: 'nmap' },
  { name: 'Angry IP Scanner' },
  { name: 'Advanced IP Scanner' },
];

export const compareRows: ComparisonRow[] = [
  // nmap's BSD support is source builds; its installers cover the other three.
  { feature: 'Platforms', cells: ['Windows, macOS, Linux', 'Windows, macOS, Linux, BSD', 'Windows, macOS, Linux', 'Windows'] },
  // Advanced IP Scanner is free, but no source code or licence text is
  // published anywhere official -- "free, no source" is what can be shown.
  { feature: 'Licence', cells: ['MIT', 'NPSL, source available', 'GPLv2', 'Free, no source'] },
  { feature: 'Command line, for scripts', cells: ['✓', '✓', '✓', 'Console version, undocumented'] },
  { feature: 'Terminal UI', cells: ['✓', '—', '—', '—'] },
  { feature: 'Desktop app', cells: ['✓', 'Zenmap', '✓', '✓'] },
  { feature: 'AI agents (MCP server)', cells: ['✓', '—', '—', '—'] },
  // NetsCLI and Angry IP Scanner both do TCP connect scans. Advanced IP
  // Scanner's docs cover checks for HTTP, HTTPS, FTP, RDP, Radmin and shared
  // folders; Famatech sells port scanning as Advanced Port Scanner.
  { feature: 'TCP ports', cells: ['✓', '✓', '✓', 'Set services only'] },
  { feature: 'UDP, OS and version detection', cells: ['—', '✓', '—', '—'] },
  // nmap resolves targets and does reverse DNS built in; record types beyond
  // that come from specific NSE scripts (dns-srv-enum and others), not a
  // general lookup.
  { feature: 'DNS records (MX, TXT, SRV…)', cells: ['✓', 'Via scripts', '—', '—'] },
  // nmap: broadcast-dns-service-discovery. Angry IP Scanner queries mDNS only
  // to name a local host when reverse DNS has no answer.
  { feature: 'mDNS devices', cells: ['✓', 'Via script', 'Hostnames only', '—'] },
  // NetsCLI's CSV comes from the desktop app; the CLI and TUI give JSON (and
  // YAML, Markdown). nmap's "text" is normal and grepable output; it has no
  // JSON. Angry IP Scanner also writes an IP:port list.
  { feature: 'Export formats', cells: ['JSON, YAML, CSV', 'XML, text', 'CSV, XML, SQL, text', 'CSV, XML, HTML'] },
];

/** Shown under the table: where the other two are the better choice. */
export const compareNoteHtml =
  'nmap is the deeper tool for audits and security work, with SYN and UDP scans, service and OS detection, and over 600 scripts. Advanced IP Scanner is built around acting on the Windows machines it finds: RDP and Radmin sessions, remote shutdown and Wake-on-LAN. NetsCLI does neither.';
