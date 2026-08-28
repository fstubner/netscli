// Does the built changelog page show the dates CHANGELOG.md actually claims?
//
// This exists because the answer was "no" twice in one day, in opposite
// directions, and neither was visible from the source diff:
//
//   1. Every version heading got a `published_at` built from its own
//      heading date, so 0.3.1 was presented as published on 24 Aug 2026
//      while no tag for it existed.
//   2. Fixing that keyed the rule on `unreleased`, which the build-time
//      render sets on *every* entry -- so the no-JS page lost the dates of
//      releases that really had shipped.
//
// Both are markup that renders as something plausible and wrong, on a page
// nobody re-reads, so neither `astro check` nor the a11y pass would ever
// notice. This reads the built HTML and compares it against the source of
// truth. Run after `astro build`.
//
//   node ./scripts/changelog-dates.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(siteRoot, 'dist', 'changelog', 'index.html');
const changelog = path.join(siteRoot, '..', 'CHANGELOG.md');

if (!fs.existsSync(built)) {
  console.error(`No built changelog at ${built}. Run \`npm run build\` first.`);
  process.exit(1);
}

/** `## [0.3.0] — 2026-08-20` -> { version: '0.3.0', date: '2026-08-20' }. */
const declared = [...fs.readFileSync(changelog, 'utf8').matchAll(
  /^## \[([^\]]+)\](?:\s+(?:—|-)\s+(\d{4}-\d{2}-\d{2}))?/gm
)]
  .map(([, version, date]) => ({ version, date }))
  .filter(({ version }) => version.toLowerCase() !== 'unreleased')
  .slice(0, 8);

// Strip <script> first: the client-side data blob repeats every field and
// would satisfy any naive search for a date that the page never renders.
const html = fs.readFileSync(built, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
// Each card opens with `class="release-head"` and carries its heading and,
// when there is one, its `release-meta` date inside that element. Splitting
// on the head keeps the two paired even though the notes between one card
// and the next run to thousands of characters.
const cards = html
  .split('class="release-head"')
  .slice(1)
  .map((chunk) => {
    // Bounded by the body that always follows, not by the first `</div>`:
    // the heading sits inside its own `release-title-group`, so closing at
    // that div cuts the head off before the date it is meant to find.
    const bodyAt = chunk.indexOf('class="release-body"');
    const head = chunk.slice(0, bodyAt === -1 ? chunk.length : bodyAt);
    return {
      label: (head.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, ''])[1].replace(/<[^>]+>/g, '').trim(),
      date: (head.match(/class="release-meta"[^>]*>([^<]*)</) || [, ''])[1].trim(),
    };
  });

const monthNames = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const asIso = (rendered) => {
  const m = rendered.match(/^(\d{1,2}) (\w{3}) (\d{4})$/);
  if (!m) return null;
  const month = monthNames.indexOf(m[2]) + 1;
  if (month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
};

const failures = [];
for (const { version, date } of declared) {
  const card = cards.find((c) => c.label === `v${version}` || c.label === version);
  if (!card) {
    failures.push(`${version}: no card rendered on the built page`);
    continue;
  }
  if (date && !card.date) {
    failures.push(
      `${version}: CHANGELOG.md dates it ${date}, the page shows no date. ` +
        `A shipped release lost its date.`
    );
  } else if (date && asIso(card.date) !== date) {
    failures.push(`${version}: CHANGELOG.md says ${date}, the page shows "${card.date}"`);
  } else if (!date && card.date) {
    failures.push(
      `${version}: CHANGELOG.md gives it no date, the page shows "${card.date}". ` +
        `An unreleased version is being presented as published.`
    );
  }
}

// The check above asks whether the page relays what CHANGELOG.md says. It
// cannot catch the other half: CHANGELOG.md itself dating a version that was
// never tagged, which the page then relays faithfully. That is what happened
// to 0.3.1 -- dated in the release commit, tagged never. Ask git.
let tags;
try {
  tags = new Set(
    execFileSync('git', ['tag', '--list'], { cwd: siteRoot, encoding: 'utf8' })
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
} catch {
  tags = null;
}

if (tags === null || tags.size === 0) {
  // Fail rather than skip. A checkout without tags is the normal CI default
  // (`fetch-depth: 1` fetches none), and a check that quietly passes there
  // is worth nothing -- which is the shape of bug this whole file is about.
  console.error(
    'No git tags available, so a dated-but-untagged version cannot be detected.\n' +
      'Check out with `fetch-depth: 0` (see site.yml) or run this in a full clone.'
  );
  process.exit(1);
}

for (const { version, date } of declared) {
  if (date && !tags.has(`v${version}`)) {
    failures.push(
      `${version}: CHANGELOG.md dates it ${date}, but there is no v${version} tag. ` +
        `The date goes on with the tag, not with the version bump.`
    );
  }
}

if (failures.length > 0) {
  console.error('Changelog dates on the built page disagree with CHANGELOG.md:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nA version heading carries a date only once its release is published;' +
      '\nthe page must relay exactly that. See the note at the top of CHANGELOG.md.'
  );
  process.exit(1);
}

console.log(`${declared.length} changelog entr(ies) render the date CHANGELOG.md declares.`);
