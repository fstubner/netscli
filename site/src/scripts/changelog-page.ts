import { normalizeTag } from './changelog/summarize';
import { hydrateReleaseDisclosures, renderReleaseList } from './changelog/release-list';
import type { ChangelogRelease } from './changelog/types';

export type { ChangelogRelease };

export function initChangelogPage(
  repo: string,
  fallbackReleases: ChangelogRelease[],
  releaseSummaries: Record<string, string>
): void {
  const year = document.getElementById('y');
  if (year) year.textContent = String(new Date().getFullYear());

  const fallbackByTag = new Map(
    fallbackReleases.map((release) => [normalizeTag(release.tag_name || release.name), release])
  );

  // The list is already in the HTML, rendered at build time from this repo's
  // CHANGELOG.md by this same renderer, so there is nothing to paint here --
  // only the collapse to attach, which needs a laid-out page.
  //
  // Nothing in that markup links a tag, for the same reason the fetch below
  // is careful: linking optimistically is how the v0.3.0 card ended up
  // pointing at a GitHub 404 for weeks. A tag is asserted once confirmed,
  // not before.
  hydrateReleaseDisclosures();

  fetch(`https://api.github.com/repos/${repo}/releases?per_page=8`)
    .then((response) => {
      if (!response.ok) throw new Error(`GitHub releases request failed with ${response.status}`);
      return response.json();
    })
    .then((releases: ChangelogRelease[]) => {
      const remoteTags = new Set(releases.map((release) => normalizeTag(release.tag_name || release.name)));
      // A changelog entry with no release behind it stays unlinked.
      const localOnlyReleases = fallbackReleases
        .filter((release) => !remoteTags.has(normalizeTag(release.tag_name || release.name)))
        .map((release) => ({ ...release, unreleased: true, confirmedUnreleased: true }));
      renderReleaseList([...localOnlyReleases, ...releases], repo, fallbackByTag, releaseSummaries);
    })
    .catch(() => {
      // Deliberately nothing. The build-time render is already on screen and
      // is accurate -- it just has not been told which tags are published.
      // Replacing it with an error would throw away the notes the reader
      // came for because a metadata request failed.
    });
}
