#!/usr/bin/env node
//
// Every netscli.com URL the desktop app links to must be a page the site
// actually builds.
//
//   node scripts/check-app-doc-links.mjs
//
// Why this exists: the "Open setup docs" button pointed at a GitHub README
// anchor that the app's own URL allowlist refused, and the refusal was
// swallowed, so the button silently did nothing. Repointing it at the docs
// site fixed the swallow but introduced the opposite hazard -- an app that
// links confidently at a page the site may not have. Nothing in either
// project would have noticed: the app does not know what the site publishes,
// and the site does not know what the app links to.
//
// Checked against the content sources rather than `site/dist`, so this needs
// no build and can run in both workflows. Starlight maps
// `src/content/docs/<path>.md` to `/<path>/` one-to-one; the routes outside
// that collection come from `src/pages/*.astro`, which is why both are
// consulted.
//
// It cannot tell whether the site is deployed. A page present here and absent
// from netscli.com is a deployment gap, and this check will not see it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = path.join(repoRoot, 'apps/netscli-gui/src');
const docsRoot = path.join(repoRoot, 'site/src/content/docs');
const pagesRoot = path.join(repoRoot, 'site/src/pages');

const SITE_ORIGIN = 'https://netscli.com';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

/** Every netscli.com link in the app, with the file that writes it. */
function findLinks() {
  const links = [];
  for (const file of sourceFiles(appSource)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/https:\/\/netscli\.com[^\s'"`)]*/g)) {
      links.push({ url: match[0], file: path.relative(repoRoot, file).replaceAll(path.sep, '/') });
    }
  }
  return links;
}

/** Whether the site builds a page at this path. */
function siteHasRoute(pathname) {
  const slug = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  // The site root and anything under src/pages.
  const pageCandidates = slug
    ? [`${slug}.astro`, path.join(slug, 'index.astro')]
    : ['index.astro'];
  if (pageCandidates.some((candidate) => fs.existsSync(path.join(pagesRoot, candidate)))) {
    return true;
  }
  if (!slug) return false;

  // Starlight content: /docs/packet-capture/ -> src/content/docs/docs/packet-capture.md
  const contentCandidates = [
    `${slug}.md`,
    `${slug}.mdx`,
    path.join(slug, 'index.md'),
    path.join(slug, 'index.mdx'),
  ];
  return contentCandidates.some((candidate) => fs.existsSync(path.join(docsRoot, candidate)));
}

const failures = [];
const links = findLinks();

for (const { url, file } of links) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    failures.push(`${file}: "${url}" is not a URL`);
    continue;
  }
  if (parsed.origin !== SITE_ORIGIN) continue;
  if (!siteHasRoute(parsed.pathname)) {
    failures.push(
      `${file}: links to ${url}, which the site does not build. ` +
        `Expected site/src/content/docs${parsed.pathname.replace(/\/$/, '')}.md or a matching page.`,
    );
  }
}

if (failures.length > 0) {
  console.error('App links to site pages that do not exist:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`App doc links OK: ${links.length} netscli.com link(s), all built by the site.`);
}
