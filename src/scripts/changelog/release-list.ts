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
    // A *confirmed* unreleased entry has no publication date, and must not
    // borrow the fallback's. `published_at` there comes from the date on the
    // CHANGELOG.md heading, so this line used to resurrect a date for the
    // very entry GitHub had just confirmed was never released -- the card
    // read "Not yet released" beside "24 Aug 2026", and the date is the half
    // that reads as a fact.
    //
    // `confirmedUnreleased`, not `unreleased`: the same distinction the
    // heading label draws a few lines below. The build-time render marks
    // every entry `unreleased` because nothing has confirmed any tag yet, so
    // keying on that dropped the date from every card on the no-JS page --
    // including releases that really did ship.
    published_at: release.confirmedUnreleased
      ? undefined
      : release.published_at || fallback?.published_at,
    body: fallback?.body || release.body || '',
    summary: releaseSummaries[tag] || fallback?.summary || release.summary,
  };
}

/**
 * Emit the collapsed structure. Runs at BUILD time as well as in the browser,
 * and measures nothing.
 *
 * It used to measure: `scrollHeight` after a `requestAnimationFrame`, to decide
 * whether a card was long enough to be worth collapsing. That decision cannot
 * exist before layout, so the page shipped every release fully expanded and
 * collapsed them once a module had run -- painting at about 10,700px and
 * snapping to about 3,750px a moment later. A ~7,000px jump on every visit.
 *
 * So the decision moved off the critical path rather than being made faster.
 * Every card is collapsible in the markup; the CSS only applies the clamp
 * under `html[data-js]`, which the pre-paint script in Page.astro sets, so the
 * clamp is in effect before the first frame and a reader without JavaScript
 * still gets the full notes and no dead button.
 *
 * `hydrateReleaseDisclosures` then corrects the rare card that turns out to be
 * short enough not to need it. Measured across all eight releases at 1600,
 * 1100, 700 and 420: every one exceeds the threshold at every width, the
 * narrowest margin being 405px against 380. So the correction is a no-op
 * today, and the shift it can cause is bounded by the threshold rather than by
 * the length of the release notes.
 */
export function renderReleaseDisclosure(item: HTMLElement, body: HTMLElement, index: number): void {
  const bodyId = `release-body-${index}`;
  body.id = bodyId;
  item.classList.add('release-collapsible');

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
}

/**
 * Wire the toggle rendered above, and drop the collapse from any card that
 * does not need one.
 *
 * `scrollHeight` reports the full content height even while `max-height` is
 * clipping it, so the check still works against an already-collapsed card.
 */
export function setupReleaseDisclosure(item: HTMLElement, body: HTMLElement): void {
  const collapsedHeight = window.matchMedia('(max-width: 42rem)').matches ? 260 : 300;
  const minimumOverflow = 80;
  const button = item.querySelector<HTMLButtonElement>('.release-toggle');
  if (!button) return;

  if (body.scrollHeight <= collapsedHeight + minimumOverflow) {
    item.classList.remove('release-collapsible');
    item.querySelector('.release-disclosure')?.remove();
    return;
  }

  body.style.setProperty('--release-collapsed-height', `${collapsedHeight}px`);

  button.addEventListener('click', () => {
    const expanded = !item.classList.contains('release-expanded');
    body.style.setProperty('--release-expanded-height', `${body.scrollHeight}px`);
    item.classList.toggle('release-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Collapse release notes' : 'Show full release notes');
    button.textContent = expanded ? 'Show less' : 'Show more';
    if (!expanded) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    // Always rendered, at build time as well as in the browser -- the markup
    // no longer depends on a measurement. Only the wiring does.
    renderReleaseDisclosure(item, body, index);
    if (interactive) setupReleaseDisclosure(item, body);
  }
  updateReleaseTimeline(releases.map((release) => mergeRelease(release, fallbackByTag, releaseSummaries)));
  return true;
}

/**
 * Make the build-rendered toggles work.
 *
 * The cards arrive already collapsed -- see renderReleaseDisclosure -- so this
 * attaches click handlers and nothing about the page moves. It used to be the
 * step that introduced the collapse, which is what made the changelog jump on
 * every load.
 */
export function hydrateReleaseDisclosures(): void {
  const items = document.querySelectorAll<HTMLElement>('#release-list .release-item');
  items.forEach((item) => {
    const body = item.querySelector<HTMLElement>('.release-body');
    if (body) setupReleaseDisclosure(item, body);
  });
}
