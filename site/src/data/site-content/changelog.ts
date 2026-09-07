import type { SectionCopy } from './types';
import { meta } from './meta';

// The changelog page's own copy, and one plain-language summary per release.
//
// The page reads GitHub Releases at runtime and falls back to CHANGELOG.md,
// so the version list itself is never written here. These summaries are the
// part a person writes: what a release meant for someone using the product,
// in a sentence, above the generated notes. A tag with no entry here simply
// renders without one.
export const changelogCopy: SectionCopy = {
  heading: `${meta.siteName} release notes`,
  leadHtml: `Versioned release notes for shipped ${meta.siteName} changes, fixes, and packaging updates.`,
};

/** Shown when the page is shared. */
export const changelogOgDescription = `Versioned ${meta.siteName} release notes and shipped changes.`;

/* One curated line per release, shown above the expandable body.
 *
 * A tag with no entry here falls back to a summary derived from the release
 * body, which is fine for a short entry and poor for a long one -- so any
 * release whose CHANGELOG section opens with prose wants a line here, or the
 * page prints that prose twice. See scripts/changelog/summarize.ts.
 *
 * No 'v0.3.0': it was tagged, its notes were drafted, and no release was ever
 * published from it. Its entries are under 0.3.1 and there is no 0.3.0 for
 * this map to describe. */
export const releaseSummaries: Record<string, string> = {
  'v0.3.1':
    'The desktop app is redesigned around a denser diagnostic workspace, with reorderable tabs, right-click tab management and a refreshed icon. Port scans return richer status data on every interface, probe concurrency is configurable everywhere, and the website and docs were rebuilt alongside. Four months of work since 0.2.6, and much of the long tail is fixes for code that reported success while doing nothing.',
  'v0.2.6':
    'Installed GUI builds now identify themselves correctly, and the Windows title-bar controls work. Also completes the CLI/TUI refactors that make future interface changes easier to review and test.',
  'v0.2.5':
    'Closes a DNS resolver security advisory. Windows subnet detection is fixed, so discovery and sweep find real LAN hosts again, and package publishing now covers GUI installers.',
  'v0.2.4':
    'v0.2.3 built the GUI installers but never attached them. Publishing is repaired here, along with the AUR deploy action that was blocking Linux packages.',
  'v0.2.3':
    'GUI installer builds move again once the Tauri JavaScript and Rust versions agree, and the AUR packaging handoff is fixed. CLI packages were already usable from v0.2.2; the GUI artifacts needed these pipeline fixes.',
  'v0.2.2':
    'This is a release-pipeline recovery build. It refreshes Cargo.lock so locked release builds can run reproducibly after dependency bumps, giving package-manager users a working replacement for the failed v0.2.1 artifacts.',
  'v0.2.1':
    'Desktop installers and signed release assets mean you no longer need a Rust toolchain to install. Adds concurrency tuning for networks that struggle with large parallel scans.',
  'v0.2.0':
    'Turns the initial scanner into something distributable. mDNS discovery and typed core errors on the product side; shell completions, man pages, package-manager templates and signed artifacts on the shipping side.',
  'v0.1.1':
    'Cleans up the first public version with crate documentation, security notes and a structured changelog, plus the release workflow fixes that make binaries and pcap variants reproducible.',
  'v0.1.0':
    'The first public NetsCLI release. One Rust core powers the CLI, terminal UI, desktop app, and MCP server, with structured output and cross-platform binaries for early users.',
};
