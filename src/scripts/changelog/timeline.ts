import { el } from './markdown-inline';
import { normalizeTag } from './summarize';
import type { ChangelogRelease } from './types';

export function releaseAnchorId(release: ChangelogRelease): string {
  return `release-${normalizeTag(release.tag_name || release.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

export function updateReleaseTimeline(releases: ChangelogRelease[]): void {
  const timeline = document.getElementById('release-timeline');
  if (!timeline || !Array.isArray(releases) || releases.length === 0) return;

  const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const yearGroups = new Map<string, Map<string, { label: string; count: number; href: string }>>();

  releases.forEach((release) => {
    const publishedDate = release.published_at ? new Date(release.published_at) : null;
    if (!publishedDate || Number.isNaN(publishedDate.getTime())) return;

    const yearLabel = String(publishedDate.getFullYear());
    const monthKey = `${yearLabel}-${String(publishedDate.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = monthFormat.format(publishedDate);
    const releaseId = releaseAnchorId(release);

    if (!yearGroups.has(yearLabel)) yearGroups.set(yearLabel, new Map());
    const months = yearGroups.get(yearLabel)!;
    if (!months.has(monthKey)) {
      months.set(monthKey, { label: monthLabel, count: 0, href: `#${releaseId}` });
    }
    months.get(monthKey)!.count += 1;
  });

  timeline.textContent = '';
  if (yearGroups.size === 0) {
    timeline.append(el('span', 'release-timeline-empty', 'No dates'));
    return;
  }

  yearGroups.forEach((months, yearLabel) => {
    const group = el('div', 'release-timeline-group');
    group.append(el('strong', 'release-timeline-year', yearLabel));

    months.forEach((month) => {
      const link = document.createElement('a');
      link.href = month.href;
      link.className = 'release-timeline-link';
      link.dataset.releaseTarget = month.href.slice(1);
      link.innerHTML = `<span>${month.label}</span><small>${month.count}</small>`;
      group.append(link);
    });

    timeline.append(group);
  });

  const timelineLinks = [...timeline.querySelectorAll<HTMLAnchorElement>('.release-timeline-link')];
  const releaseItems = timelineLinks
    .map((link) => document.getElementById(link.dataset.releaseTarget || ''))
    .filter((item): item is HTMLElement => Boolean(item));

  if (!('IntersectionObserver' in window) || releaseItems.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;

      timelineLinks.forEach((link) => {
        link.classList.toggle('active', link.dataset.releaseTarget === visible.target.id);
      });
    },
    { rootMargin: '-18% 0px -62% 0px', threshold: [0.12, 0.35, 0.6] }
  );

  releaseItems.forEach((item) => observer.observe(item));
  timelineLinks[0]?.classList.add('active');
}
