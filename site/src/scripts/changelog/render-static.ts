/**
 * Render the release list at build time, using the same renderer the browser
 * uses.
 *
 * The page used to ship "Loading release notes..." and paint the notes in
 * from script. Everything needed was already known at build time — the
 * entries come from the repo's own CHANGELOG.md — so a crawler or a reader
 * without JavaScript got an empty page whose entire purpose is release
 * notes.
 *
 * Running the real renderer under a build-time DOM, rather than writing a
 * second server-side one, is deliberate: the card markup sits on top of ~400
 * lines of markdown-to-DOM conversion, and two copies of that would drift
 * apart quietly. The one thing skipped is the disclosure that collapses long
 * cards, which measures `scrollHeight` and so needs a laid-out page; the
 * client attaches it on load. That also means the no-JS rendering shows
 * every entry in full, which is the better failure direction.
 */
import { parseHTML } from 'linkedom';

import { renderReleaseList } from './release-list';
import { normalizeTag } from './summarize';
import type { ChangelogRelease } from './types';

export function renderReleaseListHtml(
  releases: ChangelogRelease[],
  repo: string,
  releaseSummaries: Record<string, string>
): { list: string; timeline: string } {
  const { document, window } = parseHTML(
    '<!doctype html><html><body>' +
      '<div id="release-list"></div>' +
      '<nav id="release-timeline"></nav>' +
      '</body></html>'
  );

  // The renderer reaches for these three; none of them exists in Node, and
  // all three are only consulted for behaviour we are skipping here anyway.
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    document: globals.document,
    window: globals.window,
    requestAnimationFrame: globals.requestAnimationFrame,
  };
  globals.document = document;
  globals.window = Object.assign(window, {
    location: { origin: 'https://netscli.com' },
    matchMedia: () => ({ matches: false }),
  });
  globals.requestAnimationFrame = (fn: () => void) => fn();

  try {
    // Nothing is confirmed released at build time: GitHub has not been asked
    // yet. Marking them unreleased keeps the same rule the client follows —
    // never link a tag until something has confirmed it exists.
    const asUnreleased = releases.map((release) => ({ ...release, unreleased: true }));
    const fallbackByTag = new Map(
      releases.map((release) => [normalizeTag(release.tag_name || release.name), release])
    );
    renderReleaseList(asUnreleased, repo, fallbackByTag, releaseSummaries, { interactive: false });
    return {
      list: document.getElementById('release-list')?.innerHTML ?? '',
      timeline: document.getElementById('release-timeline')?.innerHTML ?? '',
    };
  } finally {
    globals.document = saved.document;
    globals.window = saved.window;
    globals.requestAnimationFrame = saved.requestAnimationFrame;
  }
}
