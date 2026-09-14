import { getCollection } from 'astro:content';
import { site } from '../data/site';

/**
 * /llms-full.txt — every documentation page's full text, in one file.
 *
 * The companion to /llms.txt, which is a *map*: titles, descriptions and
 * links. A model following that map has to fetch eleven pages to answer
 * anything, and an answer engine crawling a site it has not indexed often
 * will not. This is the same corpus already inlined, in the order the
 * sidebar presents it.
 *
 * Generated from the content collection, not hand-written, for the reason
 * llms.txt.ts gives: a second copy of the documentation is a copy that
 * drifts, and this repo has already shipped a landing page advertising a
 * version that was never released.
 *
 * Convention follows llmstxt.org's `llms-full.txt`: the same H1 and summary
 * as /llms.txt, then each page as an H2 with its body verbatim.
 */
export async function GET() {
  const { meta, hero } = site;
  const base = meta.domain.replace(/\/$/, '');

  const docs = (await getCollection('docs'))
    .filter((entry) => entry.id !== 'index')
    .sort((a, b) => a.id.localeCompare(b.id));

  const sections = docs.flatMap((entry) => {
    const url = `${base}/${entry.id.replace(/\/?index$/, '')}/`.replace(/\/+$/, '/');
    // `body` is the raw markdown as authored, before Starlight renders it.
    // Kept verbatim rather than stripped: the headings, code fences and
    // tables are what make it readable to a model, and re-flowing it here
    // would be a second renderer to keep in step with the real one.
    const body = (entry.body ?? '').trim();
    return [
      `## ${entry.data.title}`,
      '',
      `Source: ${url}`,
      ...(entry.data.description ? ['', entry.data.description] : []),
      '',
      body,
      '',
    ];
  });

  const lines = [
    `# ${meta.siteName}`,
    '',
    `> ${hero.subhead}`,
    '',
    meta.description,
    '',
    `Full documentation text. The link map is at ${base}/llms.txt.`,
    '',
    ...sections,
  ];

  return new Response(`${lines.join('\n').trimEnd()}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
