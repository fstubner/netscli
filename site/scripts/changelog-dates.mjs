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
//
// A third way, found later: a dated heading is not a published release. The
// date goes on once the tag is pushed, before the release is public, so the
// live page showed 0.3.5 with its date while the release was a draft. The
// build that deploys (pages.yml) is told which releases GitHub lists as
// published, in NETSCLI_PUBLISHED_RELEASES (see
// src/data/site-content/version.ts). Run with the same variable set, this
// checks that the page dates exactly those, and labels every other entry
// "Not yet released" without a date. Without it, it checks that the page
// relays CHANGELOG.md's dates as written.

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
    const heading = (head.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, ''])[1];
    return {
      // The "Not yet released" label is a span inside the heading; the
      // version is the rest of it.
      label: heading
        .replace(/<span class="release-unreleased"[^>]*>[\s\S]*?<\/span>/, '')
        .replace(/<[^>]+>/g, '')
        .trim(),
      notYetReleased: /class="release-unreleased"/.test(heading),
      date: (head.match(/class="release-meta"[^>]*>([^<]*)</) || [, ''])[1].trim(),
    };
  });

// Set only by a build that was told which releases are published. An empty
// list means pages.yml could not ask, and then the page claims no dates.
const publishedEnv = process.env.NETSCLI_PUBLISHED_RELEASES;
const published =
  publishedEnv === undefined ? null : new Set(publishedEnv.split(/\s+/).filter(Boolean));

// Format the expected date exactly as the page does, rather than parsing what
// the page produced. `release-list.ts` formats with the *ambient* locale, so
// the same build renders "20 Aug 2026" on an en-GB machine and "Aug 20, 2026"
// on a CI runner -- a reader that assumed either one failed on the other. The
// date is built from the CHANGELOG heading the same way `changelog.astro`
// does it, so this compares like with like wherever it runs.
const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const asRendered = (iso) => dateFormat.format(new Date(`${iso}T00:00:00.000Z`));

const failures = [];
for (const { version, date } of declared) {
  const card = cards.find((c) => c.label === `v${version}` || c.label === version);
  if (!card) {
    failures.push(`${version}: no card rendered on the built page`);
    continue;
  }
  if (published !== null && !published.has(`v${version}`)) {
    // GitHub does not list it as published, or could not be asked. Either
    // way the page must not date it.
    if (card.date) {
      failures.push(
        `${version}: GitHub lists no published release for it, the page shows "${card.date}". ` +
          `An unreleased version is being presented as published.`
      );
    } else if (published.size > 0 && !card.notYetReleased) {
      failures.push(`${version}: GitHub lists no published release for it, and the page does not say "Not yet released".`);
    }
    continue;
  }
  if (card.notYetReleased) {
    failures.push(`${version}: the page says "Not yet released" about a published release.`);
  }
  if (date && !card.date) {
    failures.push(
      `${version}: CHANGELOG.md dates it ${date}, the page shows no date. ` +
        `A shipped release lost its date.`
    );
  } else if (date && card.date !== asRendered(date)) {
    failures.push(
      `${version}: CHANGELOG.md says ${date} (renders as "${asRendered(date)}"), ` +
        `the page shows "${card.date}"`
    );
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
    '\nA version heading is dated once its tag exists. The page dates a version only' +
      '\nwhen it may: as CHANGELOG.md says in a build that was not told which releases' +
      '\nare published, and only for published releases in one that was. See the note' +
      '\nat the top of CHANGELOG.md.'
  );
  process.exit(1);
}

console.log(
  published === null
    ? `${declared.length} changelog entr(ies) render the date CHANGELOG.md declares.`
    : published.size === 0
      ? `${declared.length} changelog entr(ies) checked. The build was not told any published release, and dates none.`
      : `${declared.length} changelog entr(ies) checked against the ${published.size} published release(s) GitHub lists.`
);
