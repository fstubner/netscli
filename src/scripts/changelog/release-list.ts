import { el, externalLink } from './markdown-inline';
import { renderMarkdown } from './markdown-block';
import { normalizeTag } from './summarize';
import { releaseAnchorId, updateReleaseTimeline } from './timeline';
import type { ChangelogRelease } from './types';

function mergeRelease(
  release: ChangelogRelease,
  fallbackByTag: Map<string, ChangelogRelease>,
  releaseSummaries: Record<string, string>
): ChangelogRelease {
  const tag = normalizeTag(release.tag_name || release.name);
  const fallback = fallbackByTag.get(tag);
  return {
    ...(fallback || {}),
    ...release,
    tag_name: release.tag_name || fallback?.tag_name || tag,
    name: release.name || fallback?.name || tag,
    html_url: release.html_url || fallback?.html_url,
    published_at: release.published_at || fallback?.published_at,
    body: fallback?.body || release.body || '',
    summary: releaseSummaries[tag] || fallback?.summary || release.summary,
  };
}

function setupReleaseDisclosure(item: HTMLElement, body: HTMLElement, index: number): void {
  const collapsedHeight = window.matchMedia('(max-width: 42rem)').matches ? 260 : 300;
  const minimumOverflow = 80;
  const bodyId = `release-body-${index}`;
  body.id = bodyId;

  requestAnimationFrame(() => {
    if (body.scrollHeight <= collapsedHeight + minimumOverflow) return;

    item.classList.add('release-collapsible');
    body.style.setProperty('--release-collapsed-height', `${collapsedHeight}px`);
    body.style.setProperty('--release-expanded-height', `${body.scrollHeight}px`);

    const disclosure = el('div', 'release-disclosure');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'release-toggle';
    button.setAttribute('aria-controls', bodyId);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Show full release notes');
    button.textContent = 'Show more';
    disclosure.append(button);
    item.append(disclosure);

    button.addEventListener('click', () => {
      const expanded = !item.classList.contains('release-expanded');
      body.style.setProperty('--release-expanded-height', `${body.scrollHeight}px`);
      item.classList.toggle('release-expanded', expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', expanded ? 'Collapse release notes' : 'Show full release notes');
      button.textContent = expanded ? 'Show less' : 'Show more';
      if (!expanded) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}

export function renderReleaseList(
  releases: ChangelogRelease[],
  repo: string,
  fallbackByTag: Map<string, ChangelogRelease>,
  releaseSummaries: Record<string, string>
): boolean {
  const list = document.getElementById('release-list');
  if (!list || !Array.isArray(releases) || releases.length === 0) return false;
  list.textContent = '';
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  for (const [index, sourceRelease] of releases.entries()) {
    const release = mergeRelease(sourceRelease, fallbackByTag, releaseSummaries);
    const item = document.createElement('article');
    item.className = 'release-item';
    item.id = releaseAnchorId(release);

    const header = el('div', 'release-head');
    const headingGroup = el('div', 'release-title-group');
    const heading = document.createElement('h2');
    const label = release.name || release.tag_name || 'Release';
    if (release.unreleased) {
      // No link. Nothing has confirmed the tag exists, and `html_url` would
      // point at a GitHub 404 if it does not -- which is what the v0.3.0 card
      // did while the version was bumped in the repo but never tagged.
      heading.appendChild(document.createTextNode(label));
      // Labelled only once GitHub has answered. Before that we do not know it
      // is unreleased, only that we have not confirmed it is released.
      if (release.confirmedUnreleased) {
        const pending = el('span', 'release-unreleased');
        pending.textContent = 'Not yet released';
        heading.appendChild(pending);
      }
    } else {
      const releaseUrl = release.html_url || `https://github.com/${repo}/releases`;
      heading.appendChild(externalLink(releaseUrl, label));
    }

    const meta = document.createElement('p');
    meta.className = 'release-meta';
    const published = release.published_at ? dateFormat.format(new Date(release.published_at)) : '';
    meta.textContent = published;
    headingGroup.append(heading);

    header.append(headingGroup);
    if (published) header.append(meta);

    const body = renderMarkdown(release.body || '', release, repo, releaseSummaries);
    item.append(header, body);
    list.appendChild(item);
    setupReleaseDisclosure(item, body, index);
  }
  updateReleaseTimeline(releases.map((release) => mergeRelease(release, fallbackByTag, releaseSummaries)));
  return true;
}
