import { normalizeTag } from './changelog/summarize';
import { hydrateReleaseDisclosures, renderReleaseList } from './changelog/release-list';
import type { ChangelogRelease } from './changelog/types';

export type { ChangelogRelease };

export function initChangelogPage(
  repo: string,
  fallbackReleases: ChangelogRelease[],
  releaseSummaries: Record<string, string>
): void {
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
      const remoteByTag = new Map(
        releases.map((release) => [normalizeTag(release.tag_name || release.name), release])
      );
      // The order comes from the local changelog, not from grouping remote
      // and local-only entries into two blocks. Putting every unreleased
      // entry ahead of every released one put a version that was never
      // tagged above the actual latest release, even when the changelog
      // listed it lower down. Walking `fallbackReleases` in its own order
      // and swapping in the remote data where GitHub has confirmed it keeps
      // each entry where the changelog puts it.
      //
      // A changelog entry with no release behind it stays unlinked, and
      // loses its date. `published_at` is built from the date on the
      // CHANGELOG.md heading, which is written when the entry is drafted --
      // so an entry GitHub has just told us was never released still carried
      // a publication date, and the card read "v0.3.1 · Not yet released ·
      // 24 Aug 2026". The label and the date contradicted each other, and
      // the date was the half that looked like a fact.
      const orderedReleases = fallbackReleases.map((release) => {
        const tag = normalizeTag(release.tag_name || release.name);
        const remote = remoteByTag.get(tag);
        if (remote) return remote;
        return { ...release, published_at: undefined, unreleased: true, confirmedUnreleased: true };
      });
      // A release GitHub knows about that never made it into the local
      // changelog (a hotfix tag, say) has nowhere to sit in that order, so it
      // stays in the fetch's own order at the end.
      const fallbackTags = new Set(
        fallbackReleases.map((release) => normalizeTag(release.tag_name || release.name))
      );
      const extraRemoteReleases = releases.filter(
        (release) => !fallbackTags.has(normalizeTag(release.tag_name || release.name))
      );
      renderReleaseList([...orderedReleases, ...extraRemoteReleases], repo, fallbackByTag, releaseSummaries);
    })
    .catch(() => {
      // Deliberately nothing. The build-time render is already on screen and
      // is accurate -- it just has not been told which tags are published.
      // Replacing it with an error would throw away the notes the reader
      // came for because a metadata request failed.
    });
}
