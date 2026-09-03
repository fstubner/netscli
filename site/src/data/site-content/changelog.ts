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

export const releaseSummaries: Record<string, string> = {
  'v0.3.0':
    'The desktop workspace is redesigned, scan results carry richer status data, and interactive interfaces gain probe concurrency controls. Public docs are refreshed and packaging is fixed across release channels.',
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
    'Cleans up the first public version: crate documentation, security notes and a structured changelog, plus the release workflow fixes that make binaries and pcap variants reproducible.',
  'v0.1.0':
    'This is the first public NetsCLI release: one Rust core powers the CLI, terminal UI, desktop app, and MCP server, with structured output and cross-platform binaries for early users.',
};
