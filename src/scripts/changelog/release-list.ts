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

export function setupReleaseDisclosure(item: HTMLElement, body: HTMLElement, index: number): void {
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
  releaseSummaries: Record<string, string>,
  /**
   * Skip the parts that need a laid-out page.
   *
   * This same function runs at build time against a DOM with no layout, so
   * that the release notes are in the HTML instead of being painted in by
   * script. `scrollHeight` is 0 there, which would collapse every card to
   * the wrong height; the client re-applies the disclosure once it has a
   * real page. Rendering one renderer twice is the point -- the card markup
   * and the 400-odd lines of markdown conversion behind it exist once.
   */
  options: { interactive?: boolean } = {}
): boolean {
  const interactive = options.interactive !== false;
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
    if (interactive) setupReleaseDisclosure(item, body, index);
  }
  updateReleaseTimeline(releases.map((release) => mergeRelease(release, fallbackByTag, releaseSummaries)));
  return true;
}

/**
 * Attach the collapse affordance to cards that were rendered at build time.
 *
 * The server render skips it because it measures `scrollHeight`, which is 0
 * without layout. This runs once on load, against the markup already on the
 * page, so the notes are readable before any script runs and gain the
 * collapse once one does.
 */
export function hydrateReleaseDisclosures(): void {
  const items = document.querySelectorAll<HTMLElement>('#release-list .release-item');
  items.forEach((item, index) => {
    const body = item.querySelector<HTMLElement>('.release-body');
    if (body) setupReleaseDisclosure(item, body, index);
  });
}
