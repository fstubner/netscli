import { normalizeTag } from './changelog/summarize';
import { renderReleaseList } from './changelog/release-list';
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

  const renderedFallback = renderReleaseList(fallbackReleases, repo, fallbackByTag, releaseSummaries);

  fetch(`https://api.github.com/repos/${repo}/releases?per_page=8`)
    .then((response) => {
      if (!response.ok) throw new Error(`GitHub releases request failed with ${response.status}`);
      return response.json();
    })
    .then((releases: ChangelogRelease[]) => {
      const remoteTags = new Set(releases.map((release) => normalizeTag(release.tag_name || release.name)));
      const localOnlyReleases = fallbackReleases.filter(
        (release) => !remoteTags.has(normalizeTag(release.tag_name || release.name))
      );
      renderReleaseList([...localOnlyReleases, ...releases], repo, fallbackByTag, releaseSummaries);
    })
    .catch(() => {
      const list = document.getElementById('release-list');
      if (list && !renderedFallback) {
        list.innerHTML =
          '<div class="release-empty">Could not load releases from GitHub right now. Use the releases link above.</div>';
      }
    });
}
