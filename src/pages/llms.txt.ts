import { getCollection } from 'astro:content';
import { site } from '../data/site';

/**
 * /llms.txt — a curated map of this site for AI answer engines.
 *
 * Generated from the same content modules the pages render, not hand-written.
 * A second hand-maintained description of the product is exactly the thing
 * that drifts: this repo has already shipped a landing page advertising a
 * version that was never released, and packaging manifests that read like
 * shipping manifests and were not. If the hero copy changes, this changes
 * with it.
 *
 * Format follows llmstxt.org: an H1, a blockquote summary, then H2 sections
 * of `[name](url): description` links.
 */
export async function GET() {
  const { meta, hero, faq, install } = site;
  const base = meta.domain.replace(/\/$/, '');

  const docs = (await getCollection('docs'))
    .filter((entry) => entry.id !== 'index')
    .map((entry) => ({
      title: entry.data.title,
      description: entry.data.description ?? '',
      url: `${base}/${entry.id.replace(/\/?index$/, '')}/`.replace(/\/+$/, '/'),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  /** The recommended command per platform, from the install content. The
   *  keys are lowercase identifiers; these are the names people read. */
  const platformNames: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
  };
  const quickstart = Object.entries(install.byPlatform).flatMap(([platform, entry]) => {
    const first = entry.cli?.[0];
    if (!first?.command) return [];
    return [`- **${platformNames[platform] ?? platform}**: \`${first.command}\``];
  });

  const lines = [
    '# NetsCLI',
    '',
    `> ${hero.subhead}`,
    '',
    meta.description,
    '',
    '## Install',
    '',
    ...quickstart,
    `- **From source**: \`cargo install netscli\``,
    '',
    'Packet capture is a compile-time feature. No published desktop installer',
    'includes it; capture-enabled CLI assets are published separately and also',
    'need a system capture library (libpcap or Npcap).',
    '',
    '## Documentation',
    '',
    ...docs.map((d) => `- [${d.title}](${d.url})${d.description ? `: ${d.description}` : ''}`),
    '',
    '## Reference',
    '',
    `- [Release notes](${base}/changelog/): what changed in each version.`,
    `- [Source](${hero.sourceUrl}): MIT licensed.`,
    '',
    '## Common questions',
    '',
    // `a` is the plain-text answer; `aHtml` is the rendered variant, and
    // markup is not what an answer engine wants.
    ...faq.flatMap((item) => [`### ${item.q}`, '', item.a, '']),
  ];

  return new Response(`${lines.join('\n').trimEnd()}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
