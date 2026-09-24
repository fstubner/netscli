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

// No source release summaries in landing/src/data/site.ts.
export const releaseSummaries: Record<string, string> = {};
