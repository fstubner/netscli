/* Compose a GitHub release body for a tag, from what is already written down.
 *
 *   node scripts/release-notes.mjs v0.3.2
 *
 * Why this exists: the body was hand-written into the draft, and
 * release-drafter regenerates that draft on every push to main. So an
 * overview survived only if nothing merged between writing it and
 * publishing. On 0.3.2 two PRs merged in that gap and the overview was gone,
 * silently -- the draft looked fine, it just held the generated PR list
 * again. A rule about ordering loses to the ordinary release sequence, which
 * is "merge the changelog, then publish".
 *
 * So publish-release.yml calls this inside the lock it already holds against
 * release-drafter, immediately before flipping the draft. Whatever the
 * drafter last left is then irrelevant.
 *
 * Nothing here is new prose. The release already has two curated
 * descriptions and this joins them:
 *
 *   - `releaseSummaries` in the site's content, one sentence on what the
 *     release meant. The site shows it above the notes; on GitHub nobody saw
 *     it, and it is exactly the framing a release body wants at the top.
 *   - The `## [X.Y.Z]` section of CHANGELOG.md, which is the detailed,
 *     human-written account and is already required to be right before a
 *     release.
 *
 * Writing a third version by hand is what produced four descriptions of one
 * release saying the same things in different words. See site #410, which
 * fixed the same duplication showing up on the changelog page.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/fstubner/netscli';

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag)) {
  console.error(`Usage: release-notes.mjs vX.Y.Z  (got ${tag ? `"${tag}"` : 'nothing'})`);
  process.exit(2);
}
const version = tag.slice(1);

/* The same slice the site does (site/src/pages/changelog.astro): heading to
 * the next heading, internal section removed. Kept in step by hand, because
 * that file is Astro frontmatter and cannot be imported from here. */
function changelogSection(text, wanted) {
  const headings = [...text.matchAll(/^## \[([^\]]+)\](?:\s+(?:—|-)\s+(\d{4}-\d{2}-\d{2}))?/gm)];
  const index = headings.findIndex((h) => h[1]?.trim() === wanted);
  if (index === -1) return null;
  const start = (headings[index].index ?? 0) + headings[index][0].length;
  const end = headings[index + 1]?.index ?? text.length;
  return text
    .slice(start, end)
    .replace(/^###\s*Changed\s*\(\s*internal\s*\)\s*$[\s\S]*?(?=^#{1,3}\s|(?![\s\S]))/gim, '')
    .trim();
}

/* The summaries live in a .ts the site authors, and it imports from
 * './meta' without an extension -- Astro resolves that, node does not, so
 * the module cannot simply be imported. The export is an object of string
 * literals, so the literal is evaluated on its own instead. A shape change
 * throws here rather than quietly producing no summary. */
function releaseSummary(wantedTag) {
  const file = join(root, 'site', 'src', 'data', 'site-content', 'changelog.ts');
  const source = readFileSync(file, 'utf8');
  const marker = 'export const releaseSummaries';
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`no ${marker} in ${file}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error(`unterminated releaseSummaries object in ${file}`);
  // Our own source, read from disk at publish time, not input from anywhere.
  const summaries = new Function(`return ${source.slice(open, close + 1)}`)();
  return summaries[wantedTag] ?? null;
}

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const section = changelogSection(changelog, version);
if (!section) {
  console.error(`No "## [${version}]" section in CHANGELOG.md. Write it before publishing.`);
  process.exit(1);
}

const summary = releaseSummary(tag);
if (!summary) {
  // Not fatal. The section alone is a complete release body, and a missing
  // summary should not block a publish at the last step. It is still worth
  // saying, because the site needs the same line and prints the body's own
  // prose twice without it.
  console.error(
    `warning: no releaseSummaries['${tag}'] in site/src/data/site-content/changelog.ts.\n` +
      `         The body will open with the changelog section. The site wants this line too.`,
  );
}

/* The entry BELOW this one, not simply the first that is not this one. The
 * file runs newest first, so those coincide for the release being cut and
 * diverge for every older tag -- `v0.2.6` produced
 * `compare/v0.3.2...v0.2.6`, a range that runs backwards. Worth getting
 * right because this is also how the notes for an old release would be
 * rebuilt. */
const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
const previous = versions[versions.indexOf(version) + 1];

process.stdout.write(
  [
    summary ? `${summary}\n` : '',
    section,
    '',
    '---',
    previous
      ? `**Full changelog:** ${REPO}/compare/v${previous}...${tag}`
      : `**Full changelog:** ${REPO}/commits/${tag}`,
    '',
  ].join('\n'),
);
