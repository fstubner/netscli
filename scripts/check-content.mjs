// Is this site still the template, or is it a product's site?
//
// Everything under src/data/site-content/, the docs pages and the assets ship
// as sample content for a fictional product called Example. That content
// builds and passes every other check in this repo -- which is the point, and
// also the problem: nothing else here can tell a finished site from an
// untouched clone. A half-replaced one is worse, because the parts still
// saying "Example" are the parts nobody looked at.
//
// So this reports what is still the sample, and what is inconsistent with
// itself: a sidebar entry with no page behind it, an image nothing serves.
// It is a setup tool rather than a CI gate -- on a fresh clone it is meant to
// fail, and it stops failing once the site is somebody's.
//
//   node scripts/check-content.mjs           # what is left to do
//   node scripts/check-content.mjs --quiet   # exit code only
//
// Exits 0 when nothing is left.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

/** Every string the sample content uses to name the fictional product.
 *  Some sample files name it only through `meta.siteName`, so a few carry a
 *  sentence of their own here instead. */
const SAMPLE_STRINGS = [
  'Example',
  'example.com',
  'your-org',
  'Your Name',
  'some-tool',
  'The first release: one binary',
  'First cut of the site from product-site-template',
  'REPLACE_ME',
];

/** Files whose sample text has to go, and what each one holds. */
const CONTENT_FILES = [
  ['src/data/site-content/meta.ts', 'the product name, domain, title, description and share image'],
  ['src/data/site-content/hero.ts', 'the headline, the install commands and the download menu'],
  ['src/data/site-content/surfaces.ts', 'the feature cards'],
  ['src/data/site-content/install.ts', 'the install routes per platform'],
  ['src/data/site-content/faq.ts', 'the questions'],
  ['src/data/site-content/footer.ts', 'the repo and what the product is built with'],
  ['src/data/site-content/changelog.ts', 'the per-release summaries'],
  ['src/data/site-content/docs.ts', 'the docs title and sidebar'],
  ['src/data/site-content/nav.ts', 'the GitHub link'],
];

const DOCS_DIR = 'src/content/docs/docs';
const findings = [];
const note = (file, message, hint) => findings.push({ file, message, hint });

// ---- 1. Sample text still in the content files -----------------------------

for (const [file, what] of CONTENT_FILES) {
  if (!exists(file)) {
    note(file, 'is missing', 'The shell imports it. Restore it, or remove its import.');
    continue;
  }
  const hits = SAMPLE_STRINGS.filter((s) => read(file).includes(s));
  if (hits.length) {
    note(
      file,
      `still uses the sample ${hits.length === 1 ? 'string' : 'strings'} ${hits.map((h) => `"${h}"`).join(', ')}`,
      `Replace ${what}.`
    );
  }
}

// ---- 2. The sample docs pages ----------------------------------------------

const SAMPLE_DOCS = ['index.md', 'install.md', 'commands.md'];
if (exists(DOCS_DIR)) {
  const untouched = fs
    .readdirSync(path.join(root, DOCS_DIR))
    .filter((page) => SAMPLE_DOCS.includes(page))
    .filter((page) => {
      const body = read(`${DOCS_DIR}/${page}`);
      return body.includes('A sample') || body.includes('These three pages are samples');
    });
  if (untouched.length) {
    note(
      DOCS_DIR,
      `${untouched.length} sample page(s) unchanged: ${untouched.join(', ')}`,
      'Write your own, or set modules.docs = false and delete the directory.'
    );
  }
}

// ---- 3. The sidebar and the pages agree ------------------------------------

if (exists('src/data/site-content/docs.ts')) {
  const links = [...read('src/data/site-content/docs.ts').matchAll(/link:\s*'([^']+)'/g)].map((m) => m[1]);
  for (const link of links) {
    // '/docs/' is the section index; '/docs/foo/' is <docs dir>/foo.md.
    const slug = link.replace(/^\/docs\/?/, '').replace(/\/$/, '');
    const page = slug === '' ? `${DOCS_DIR}/index.md` : `${DOCS_DIR}/${slug}.md`;
    if (!exists(page)) {
      note(
        'src/data/site-content/docs.ts',
        `sidebar entry "${link}" has no page`,
        `Starlight builds the link anyway, so it becomes a dead link in every page's sidebar. Write ${page}, or drop the entry.`
      );
    }
  }
}

// ---- 4. Every asset the content names is actually served -------------------

const ASSET_SOURCES = [
  'src/data/site-content/meta.ts',
  'src/data/site-content/hero.ts',
  'src/data/site-content/surfaces.ts',
  'src/data/site-content/docs.ts',
];
const checked = new Set();
for (const file of ASSET_SOURCES) {
  if (!exists(file)) continue;
  for (const [, asset] of read(file).matchAll(/'(\.?\/(?:public\/)?assets\/[^']+)'/g)) {
    const onDisk = 'public/' + asset.replace(/^\.\//, '').replace(/^public\//, '').replace(/^\//, '');
    if (checked.has(onDisk)) continue;
    checked.add(onDisk);
    if (!exists(onDisk)) {
      note(
        file,
        `names ${asset}, which is not in public/`,
        'The build does not fail on a missing image; the page just renders a gap.'
      );
    }
  }
}

// ---- 5. The placeholder images ---------------------------------------------

// Both ship as flat generated shapes. Their content hash is what identifies
// them, whatever the file is called.
//
// Byte length was the first attempt and it cried wolf immediately: a
// replacement wordmark drawn to the same geometry in a different colour
// compressed to exactly 914 bytes, and the check called it untouched.
const PLACEHOLDERS = [
  ['public/assets/wordmark.png', '72d88acb2c0aa048', 'the wordmark', 'Replace it, then re-run `npm run check:wordmark`: the inset token is measured against whichever asset meta.ts names.'],
  ['public/assets/hero.png', 'e407733cd6998d52', 'the hero screenshot', 'Replace it with a real screenshot at the dimensions hero.ts declares.'],
];
for (const [file, digest, what, hint] of PLACEHOLDERS) {
  if (!exists(file)) continue;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  if (actual.startsWith(digest)) {
    note(file, `is still the generated placeholder for ${what}`, hint);
  }
}

// ---- 6. The changelog ------------------------------------------------------

// This repo's own root when the site stands alone; a product's actual root
// when this is a subtree at product/site/ (see AGENTS.md, "If this site is a
// subtree"). Checking only 'CHANGELOG.md' missed the subtree layout entirely
// -- the file the changelog page actually reads sits one level up, and this
// check never looked there.
const CHANGELOG_STUB_STRINGS = [
  'The first release: one binary',
  'First cut of the site from product-site-template',
];
const CHANGELOG_CANDIDATES = ['CHANGELOG.md', '../CHANGELOG.md'].filter(exists);
for (const file of CHANGELOG_CANDIDATES) {
  const body = read(file);
  // The stub's own lines only. SAMPLE_STRINGS also holds generic words a
  // real changelog uses, such as `some-tool` in a usage example, and
  // matching the whole list called a real product's changelog the stub.
  if (CHANGELOG_STUB_STRINGS.some((sample) => body.includes(sample))) {
    note(
      file,
      'is still the stub',
      'The changelog page reads GitHub Releases at runtime and falls back to this file.'
    );
  }
}

// ---- 7. Sample text anywhere else in the source ---------------------------
//
// Sections 1 and 2 scan a hand-listed set of files. That list is the reason
// `programmingLanguage: 'Rust'` shipped on a site for a program written in Go:
// the value lived in src/layouts/Page.astro, which no list named, so no gate
// ever looked at it. A product fact can live anywhere in the source, so the
// scan goes everywhere in the source.
// 'public' added so an untouched favicon.svg or mark.svg -- text files that
// can carry the sample name in a <title> or a comment -- gets the same scan
// as the source. Binary assets under public/ are still skipped: SCAN_EXTS
// below is what filters them out, not this list.
const SCAN_ROOTS = ['src', 'astro.config.mjs', 'public'];
// Code only, and comments stripped before matching. The first run of this
// scan flagged three files and all three were wrong: `example.com` in a
// policy sample (the reserved documentation domain, correct there), and
// `REPLACE_ME` and `some-tool` inside comments explaining those very
// strings. The bug this exists to catch -- `programmingLanguage: 'Rust'`
// -- was a VALUE. Prose that mentions a sample string is not the same as
// code that still uses one, and a gate that cries wolf gets switched off.
// '.css' and '.svg' joined the list after this same gate shipped with no
// coverage for either: a leftover template comment in CSS, or a sample name
// left in an SVG's <title>, passed every check here before.
const SCAN_EXTS = ['.ts', '.tsx', '.astro', '.mjs', '.js', '.css', '.svg'];
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*/g, '$1 ');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro']);

const walk = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : walk(path.join(rel, entry))
  );
};

// The privacy text is never shown with the page switched off, so its sample
// is not left to do. Read from the file rather than imported: this script
// runs under plain node, which cannot load the TypeScript.
const privacyOff = /\bprivacy:\s*false\b/.test(stripComments(read('src/data/site-content/modules.ts')));

for (const file of SCAN_ROOTS.flatMap(walk)) {
  if (!SCAN_EXTS.includes(path.extname(file))) continue;
  if (privacyOff && file.replace(/\\/g, '/') === 'src/data/site-content/privacy.ts') continue;
  const body = stripComments(read(file));
  for (const sample of SAMPLE_STRINGS) {
    if (!body.includes(sample)) continue;
    note(
      file,
      `still contains the template's ${JSON.stringify(sample)}`,
      'A value that differs per product belongs in src/data/site-content/ behind a required type, so a new site cannot inherit it silently.'
    );
  }
}

// ---- Report ----------------------------------------------------------------

if (!findings.length) {
  if (!quiet) console.log("Content check OK: nothing here is still the template's sample.");
  process.exit(0);
}

if (!quiet) {
  console.log(`${findings.length} thing(s) still to replace:\n`);
  let current = null;
  for (const { file, message, hint } of findings) {
    if (file !== current) {
      console.log(`  ${file}`);
      current = file;
    }
    console.log(`    - ${message}`);
    console.log(`      ${hint}`);
  }
  console.log('\nRe-run when you have replaced them. AGENTS.md has the order to work in.');
}
process.exit(1);
