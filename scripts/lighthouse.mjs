// Lighthouse across every built route, with a floor per category.
//
//   node ./scripts/lighthouse.mjs
//
// As plain `node`, not `npm run check:lighthouse`, when running it by hand
// here: `npm run` executes inside a sandbox Chrome cannot launch from, and the
// failure is "No Chrome installations found" rather than anything naming the
// cause. The npm script exists for CI, where there is no such sandbox.
// scripts/contrast-sweep.mjs and scripts/visual-snapshot.mjs carry the same
// caveat for the same reason.
//
// WHY THIS DOES NOT USE resolveChromedriverPath
//
// Every other browser gate here drives Chrome through selenium, which needs a
// chromedriver whose major version matches the installed Chrome exactly --
// see the comment in scripts/a11y.mjs about runs dying the day ChromeDriver
// 151 shipped against Chrome 150. Lighthouse does not use chromedriver at
// all: it launches Chrome itself through chrome-launcher and speaks CDP. So
// there is no version to match, and nothing here to align with its siblings.
//
// WHY THE FLOORS ARE NOT ALL 100
//
// Both exceptions are measured, not guessed. From a full sweep of all 14
// routes on 2026-09-14:
//
//   - best-practices is 96, not 100, on the two non-Starlight pages. The
//     Cloudflare RUM beacon is fetched from cloudflareinsights.com and blocked
//     by CORS whenever the page is served from 127.0.0.1 -- which every run of
//     this script is, and every CI run will be. It passes on the real origin.
//     A floor of 100 would fail the build on a defect that exists only inside
//     the test harness.
//
//   - /404.html scores SEO 69 because `is-crawlable` fails on
//     `<meta name="robots" content="noindex, nofollow">`, which is exactly
//     what a 404 should carry. Exempted by route rather than by lowering the
//     SEO floor for every page, so a real SEO regression elsewhere still
//     fails.
//
// Everything else measured 99-100 with 0ms total blocking time, so the floors
// below sit just under what the site already does rather than at some round
// number picked by feel. They are a regression alarm, not a target.
//
// The performance floor is the exception and sits much lower -- see the note
// on it. It is the only score here that depends on how busy the machine is,
// and it swung by nine points on identical code during one afternoon.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
// The package's own desktop preset, not four constants retyped here.
//
// It sets formFactor, throttling, screenEmulation and emulatedUserAgent
// together, and Lighthouse REFUSES a config where they disagree: setting
// `formFactor: 'desktop'` on its own fails validation with "Screen emulation
// mobile setting (true) does not match formFactor setting (desktop)", because
// screenEmulation stays at its mobile default. Restating the constants by
// hand is also how desktop layout ends up scored against mobile throttling
// without anyone noticing. `--preset=desktop` on the CLI resolves to exactly
// this file.
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

import { discoverRoutes, startPreview } from './lib/preview-server.mjs';

const host = process.env.LH_HOST || '127.0.0.1';
const port = process.env.LH_PORT || '4327';
const baseUrl = `http://${host}:${port}`;
const root = process.cwd();

const discovered = discoverRoutes(root);
if (!discovered) {
  console.error('No dist/ found. Run `npm run build` first — this checks the built site.');
  process.exit(1);
}
const routes = process.env.LH_ROUTES
  ? process.env.LH_ROUTES.split(/[\s,]+/).filter(Boolean)
  : discovered;

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

const FLOORS = {
  // Deliberately far below what the site scores, because this is the one
  // number here that moves with machine load rather than with the code. Same
  // three pages, same commit, measured 2026-09-14: 93 / 92 / 91 while CI jobs
  // were running on the same machine, 100 / 100 / 100 once it was idle. A
  // floor of 95 would have failed that first run, and a gate that fails for
  // reasons the author cannot reproduce gets widened until it means nothing.
  // 85 still catches a real cliff -- an unsized hero image, a blocking script
  // -- without flaking on a busy runner.
  performance: 85,
  // These three are deterministic: they read the rendered DOM and the
  // response, not the clock, and reproduced exactly across every run today.
  // So they sit at or just under what the site already does.
  accessibility: 100,
  'best-practices': 95,
  seo: 95,
};

// Keyed by the exact route string discoverRoutes emits. It walks dist/ and
// names a directory's index.html by its prefix ('/', '/docs/') and any other
// .html by prefix + filename -- so the 404 page is '/404.html', not '/404'.
const EXEMPT = {
  '/404.html': ['seo'],
};

async function audit(chromePort, route) {
  const result = await lighthouse(
    new URL(route, baseUrl).href,
    { port: chromePort, output: 'json', logLevel: 'error' },
    // Desktop preset plus the category filter. Scoring against the default
    // mobile profile would answer a different question than "is the built site
    // fast", and would put every page under the floors above for reasons that
    // have nothing to do with a change.
    { ...desktopConfig, settings: { ...desktopConfig.settings, onlyCategories: CATEGORIES } },
  );
  if (!result?.lhr) throw new Error(`Lighthouse returned no report for ${route}`);
  return result.lhr;
}

// A profile directory we own, so chrome-launcher does not create -- or try to
// delete -- one of its own.
//
// Its `destroyTmp` runs `rmSync` on the temp profile from the child's exit
// handler, and on Windows Chrome has not always released the directory by
// then: the run prints its table, passes, and THEN throws EPERM from a
// callback no `await` can wrap, leaving a non-zero exit on a gate that
// succeeded. Passing our own directory skips that path entirely. It lives
// under the OS temp dir, so the OS cleans it up.
const profileDir = mkdtempSync(join(tmpdir(), 'netscli-lh-'));

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  userDataDir: profileDir,
});

const { cleanup } = await startPreview({
  baseUrl,
  host,
  port,
  astroCli: join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'),
  allowReuse: process.env.LH_REUSE_SERVER === '1',
  reuseHint: 'LH_REUSE_SERVER',
});

const rows = [];
const failures = [];

try {
  for (const route of routes) {
    const lhr = await audit(chrome.port, route);
    const exempt = EXEMPT[route] || [];
    const row = { route, scores: {}, exempt };

    for (const id of CATEGORIES) {
      const category = lhr.categories[id];
      if (!category || category.score === null) continue;
      const score = Math.round(category.score * 100);
      row.scores[id] = score;
      if (exempt.includes(id)) continue;
      if (score < FLOORS[id]) failures.push({ route, category: id, score, floor: FLOORS[id] });
    }
    rows.push(row);
  }
} finally {
  cleanup();
  // Never let teardown replace a real result. chrome-launcher's kill() removes
  // its temp profile directory, and on Windows Chrome has not always released
  // it yet -- the rmSync throws EPERM. Thrown from a finally, that error
  // REPLACES whatever the loop was reporting, so a genuine failure surfaced as
  // a confusing permission error about a temp directory. The profile is under
  // the OS temp dir and gets cleaned up there regardless.
  try {
    await chrome.kill();
  } catch (error) {
    console.warn(`(chrome teardown: ${error.code || error.message} — ignored)`);
  }
}

const width = Math.max(...rows.map((r) => r.route.length), 6);
console.log(`\n${'route'.padEnd(width)}  ${CATEGORIES.map((c) => c.slice(0, 5).padStart(6)).join('')}`);
for (const row of rows) {
  const cells = CATEGORIES.map((id) => {
    const score = row.scores[id];
    if (score === undefined) return '     -';
    return (row.exempt.includes(id) ? `(${score})` : String(score)).padStart(6);
  }).join('');
  console.log(`${row.route.padEnd(width)}  ${cells}`);
}
console.log('\n(n) = exempt for this route, see EXEMPT in this file.');

if (failures.length) {
  console.error(`\n✗ ${failures.length} categor(ies) below their floor:\n`);
  for (const f of failures) {
    console.error(`  ${f.route}  ${f.category}: ${f.score} < ${f.floor}`);
  }
  console.error('\nOpen the page and re-run to see which audits dropped. If the cause is the');
  console.error('harness rather than the site, say so in EXEMPT with the measurement.');
  process.exit(1);
}

console.log(`\n✓ ${rows.length} route(s) clear every category floor.`);
