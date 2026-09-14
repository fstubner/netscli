import { getCollection } from 'astro:content';
import type { GetStaticPaths } from 'astro';
import { site } from '../../data/site';

/**
 * /docs/<page>.md — one documentation page as raw markdown.
 *
 * The per-page companion to /llms-full.txt. That file is for a crawler
 * taking the whole corpus at once; this is for the two cases a single page
 * matters: the "Copy page" button in the docs header, and a person pasting
 * one page into a chat rather than the entire manual.
 *
 * ROUTE SHAPE, and why it does not collide with Starlight.
 *
 * Starlight owns /docs/* through docsLoader() and builds each page as a
 * DIRECTORY containing index.html -- /docs/cli/index.html. This emits a
 * FILE beside it, /docs/cli.md. Different paths, so both are served, and
 * the .md never shadows the page a reader visits. The same pattern the
 * repo already uses at the root for install.sh, install.ps1 and llms.txt.
 *
 * The frontmatter is re-emitted rather than dropped: title and description
 * are the two things a model reading a bare page most needs, and they live
 * in the collection's schema rather than in the body.
 */
export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');
  return docs.map((entry) => ({
    // 'docs/cli' -> 'cli'. The collection ids carry the directory the
    // content lives in; the route already supplies /docs/.
    //
    // The section index is the exception: Astro's content layer strips
    // `/index`, so src/content/docs/docs/index.md arrives as the bare id
    // 'docs' -- which the strip above does not match, and which emitted
    // /docs/docs.md. Named for what it is instead.
    params: { slug: entry.id === 'docs' ? 'index' : entry.id.replace(/^docs\//, '') },
    props: { entry },
  }));
};

export async function GET({ props }: { props: { entry: any } }) {
  const { entry } = props;
  const base = site.meta.domain.replace(/\/$/, '');
  const url = `${base}/${entry.id.replace(/\/?index$/, '')}/`.replace(/\/+$/, '/');

  const lines = [
    `# ${entry.data.title}`,
    '',
    ...(entry.data.description ? [entry.data.description, ''] : []),
    `Source: ${url}`,
    '',
    (entry.body ?? '').trim(),
  ];

  return new Response(`${lines.join('\n').trimEnd()}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
