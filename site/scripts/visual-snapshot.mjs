/* Pin the look of the built site so a refactor can prove it changed nothing.
 *
 *   node scripts/visual-snapshot.mjs record    # capture the baseline
 *   node scripts/visual-snapshot.mjs check     # capture again, compare
 *
 * Why this exists: the Starlight override layer is being audited declaration
 * by declaration, and the whole premise of that audit is "the site must look
 * identical afterwards". Without a mechanical check, every one of those
 * judgements collapses into "does this still look right to me today", which
 * is how the layer reached 958 !important declarations in the first place.
 *
 * WHAT IT IS NOT: a CI gate, and deliberately so. It compares PNG bytes, so
 * it is exact on one machine and meaningless across two -- font rasterisation
 * differs between Windows and the Ubuntu runners, and every capture would
 * differ for reasons that have nothing to do with the CSS. Committing the
 * baselines would also add megabytes of binary churn to a repo whose other
 * guards are all text. So: baselines live in a gitignored directory, and this
 * is a local before/after tool for whoever is doing the refactor.
 *
 * The existing CI gates still cover what they always did -- contrast, dead
 * CSS, axe, the build. This covers the thing none of them can: "did the page
 * move".
 *
 * Byte comparison rather than a perceptual diff is on purpose. Identical
 * input renders to identical bytes, so any difference is real; a tolerance
 * threshold is a knob that eventually gets widened until it passes. When a
 * capture differs, the two PNGs are written side by side for you to look at
 * -- a human deciding "that is the change I meant" is the point, not a
 * number deciding it.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

import { discoverRoutes, startPreview, resolveChromedriverPath } from './lib/preview-server.mjs';

const host = process.env.VISUAL_HOST || '127.0.0.1';
const port = process.env.VISUAL_PORT || '4323';
const baseUrl = `http://${host}:${port}`;
const root = process.cwd();
const baselineDir = join(root, '.visual-baseline');
const currentDir = join(root, '.visual-current');
const diffDir = join(root, '.visual-diff');

const mode = process.argv[2] || 'check';
if (!['record', 'check'].includes(mode)) {
  console.error(`Usage: visual-snapshot.mjs [record|check]  (got "${mode}")`);
  process.exit(1);
}

/* Widths, not device presets. The docs shell switches layout at 72rem and
 * again at 50rem -- the values the override layer's media queries actually
 * use -- so these sit either side of both, plus one comfortably above. A
 * preset like "iPhone 12" would tie the baseline to a device list that has
 * nothing to do with where this CSS branches. */
const WIDTHS = [1600, 1100, 700];

/* Both themes, because they carry SEPARATE colour tokens. A check that ran
 * one theme would be blind to half the colour work -- the same blind spot
 * that once hid a 1.53:1 contrast failure from every local a11y run. */
/* Selected through the site's OWN theme switch, not Chrome's.
 *
 * `--force-dark-mode` is what the a11y check uses, and it is right there
 * because axe reads computed colours. For pixels it is unusable: that flag
 * turns on Chrome's automatic darkening, which re-tints content the browser
 * decides is not already dark, progressively and by its own heuristics. Every
 * unstable capture measured during development was a dark one -- 18 of 18 in
 * the worst run -- while light was rock solid.
 *
 * Starlight persists the choice in localStorage and reflects it as
 * `data-theme` on <html>, which is also the real user path, so this tests
 * what a visitor sees rather than what a browser flag improvises. */
const THEMES = [{ name: 'light' }, { name: 'dark' }];

const discovered = discoverRoutes(root);
if (!discovered) {
  console.error('No dist/ found. Run `npm run build` first — this checks the built site.');
  process.exit(1);
}
// A subset for when you are iterating on one page and do not want to wait for
// all 84 captures. Never set in a real check: a baseline recorded from a
// subset silently compares nothing on every other route.
const routes = process.env.VISUAL_ROUTES
  ? process.env.VISUAL_ROUTES.split(/[\s,]+/).filter(Boolean)
  : discovered;

/* Build before capturing, from inside this process.
 *
 * Two bugs, one fix. This compares the BUILT site, so a CSS edit that has not
 * been rebuilt is invisible -- and that is not hypothetical: the first
 * sabotage test of this very script reported "Identical" against a
 * deliberately broken stylesheet, because the build had not been re-run.
 * Putting the build in an npm script instead would work, except `npm run`
 * here executes inside a sandbox that Chrome cannot launch from, so the
 * capture has to be started as a plain `node` process. Doing the build here
 * means the one supported invocation does both.
 */
if (process.env.VISUAL_SKIP_BUILD !== '1') {
  const { spawnSync } = await import('node:child_process');
  console.log('Building the site...');
  const built = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'],
    { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } },
  );
  if (built.status !== 0) {
    console.error('Build failed; refusing to capture a stale dist/.');
    process.exit(1);
  }
}

function slug(route, theme, width) {
  const r = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
  return `${r}__${theme}__${width}.png`;
}

/**
 * Screenshot repeatedly until two in a row are byte-identical.
 *
 * Returns the stable image, or the last one taken if the page never settles
 * (a page that genuinely never stops moving should show up as a difference
 * rather than hang the run).
 */
async function settle(driver, attempts = 6, gapMs = 200) {
  let previous = await driver.takeScreenshot();
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((r) => setTimeout(r, gapMs));
    const next = await driver.takeScreenshot();
    if (next === previous) return next;
    previous = next;
  }
  return previous;
}

/**
 * @param {string} outDir
 * @param {Array<{route:string,theme:string,width:number}>} [only]
 *   Restrict to these captures. Used by the confirmation pass, which
 *   re-takes just the handful that differed rather than all 84.
 */
async function capture(outDir, only) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const wanted = only && new Set(only.map((t) => slug(t.route, t.theme, t.width)));

  const driverPath = resolveChromedriverPath(process.env.VISUAL_CHROMEDRIVER_PATH);
  let captured = 0;

  for (const theme of THEMES) {
    const options = new chrome.Options();
    // Headless is not optional: a headed Chrome takes its colour scheme from
    // the OS and ignores --force-dark-mode, so both passes would render the
    // same theme and one would never be captured.
    options.addArguments(
      '--headless=new',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      // Blackhole every host except the local preview. The landing page and
      // the changelog both fetch api.github.com at runtime for star counts,
      // download totals and the latest release, so with the network reachable
      // the captured pixels depend on what GitHub answered and how fast --
      // measured as 2, 5 and 3 spurious differences on three consecutive runs
      // of an unchanged tree. Offline, those elements settle into one state.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      // Pin colour handling so two machines at least start from the same
      // rendering intent, and nothing re-tints behind our back.
      '--force-color-profile=srgb',
      // Text rasterisation is the last source of non-determinism: with these
      // off, the same page re-rendered differed by 30-220 bytes in a ~300KB
      // PNG -- antialiasing on glyph edges, no layout change at all. Hinting
      // and subpixel positioning are the two knobs that vary; disabling them
      // costs a little text fidelity in a throwaway screenshot and buys an
      // exact comparison.
      '--disable-lcd-text',
      '--font-render-hinting=none',
      '--disable-font-subpixel-positioning',
      '--disable-partial-raster',
      '--disable-gpu',
    );
    const service = driverPath ? new chrome.ServiceBuilder(driverPath) : undefined;
    const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
    if (service) builder.setChromeService(service);
    const driver = await builder.build();

    try {
      // Select the theme the way a visitor does, then let every later page
      // load pick it up from localStorage. Done before the warm-up so the
      // cached render and the captured render agree on the theme.
      await driver.get(new URL('/', baseUrl).href);
      await driver.executeScript(
        'localStorage.setItem("starlight-theme", arguments[0]); document.documentElement.dataset.theme = arguments[0];',
        theme.name,
      );

      // Warm-up pass: visit every route once, capturing nothing.
      //
      // Without this the FIRST visit to each page rendered differently from
      // every later one -- fonts, the Pagefind search bundle and the theme
      // script are all fetched and cached per browser session. Measured on an
      // unchanged tree: 35 differences, then 1, then 0, converging on a stable
      // state that the freshly-recorded baseline was not part of. A baseline
      // that is systematically the odd one out is worse than no baseline,
      // because the first real check looks like a regression.
      for (const route of routes) {
        await driver.get(new URL(route, baseUrl).href);
      }

      for (const width of WIDTHS) {
        for (const route of routes) {
          if (wanted && !wanted.has(slug(route, theme.name, width))) continue;
          await driver.get(new URL(route, baseUrl).href);
          // Size to the full document so the capture is the whole page, not
          // the fold. Height is read after the width is applied, because the
          // page reflows and a tall-at-1600 page is a different height at 700.
          await driver.manage().window().setRect({ width, height: 900 });
          const docHeight = await driver.executeScript(
            'return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);',
          );
          await driver.manage().window().setRect({ width, height: Math.min(Number(docHeight) + 120, 12000) });
          // Fonts and the theme script both land after first paint; without
          // this the first capture of each run differs from every later one.
          await driver.executeScript('return document.fonts ? document.fonts.ready : true;');
          // Freeze motion. A transition or animation mid-flight is a pixel
          // difference that says nothing about the CSS being audited.
          await driver.executeScript(`
            const id = '__visual_freeze__';
            if (!document.getElementById(id)) {
              const s = document.createElement('style');
              s.id = id;
              s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
              document.head.appendChild(s);
            }
          `);

          // Settle rather than sleep. A fixed delay is a guess that is either
          // too short (flaky) or too long (slow), and the right value differs
          // per page. Capturing until two consecutive frames match makes the
          // wait self-adjusting and, more importantly, makes "stable" the
          // condition being tested rather than "0.25s elapsed".
          const png = await settle(driver);
          const name = slug(route, theme.name, width);
          writeFileSync(join(outDir, name), Buffer.from(png, 'base64'));
          captured += 1;
          if (process.env.VISUAL_VERBOSE) console.log(`  ${name}`);
        }
      }
    } finally {
      await driver.quit();
    }
  }
  return captured;
}

const reuse = process.env.VISUAL_REUSE_SERVER === '1';
const { cleanup } = await startPreview({
  baseUrl,
  host,
  port,
  astroCli: join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'),
  allowReuse: reuse,
  reuseHint: 'VISUAL_REUSE_SERVER',
});

const target = mode === 'record' ? baselineDir : currentDir;
console.log(
  `Capturing ${routes.length} route(s) x ${THEMES.length} theme(s) x ${WIDTHS.length} width(s)...`,
);
const count = await capture(target);
cleanup();
console.log(`Captured ${count} image(s) into ${target.replace(root, '.')}`);

if (mode === 'record') {
  console.log('Baseline recorded. Re-run with `check` after each refactor step.');
  process.exit(0);
}

if (!existsSync(baselineDir)) {
  console.error('No baseline to compare against. Run `record` first.');
  process.exit(1);
}

const baseFiles = new Set(readdirSync(baselineDir));
const curFiles = new Set(readdirSync(currentDir));
const changed = [];
const added = [...curFiles].filter((f) => !baseFiles.has(f));
const removed = [...baseFiles].filter((f) => !curFiles.has(f));

for (const file of [...baseFiles].filter((f) => curFiles.has(f)).sort()) {
  const a = readFileSync(join(baselineDir, file));
  const b = readFileSync(join(currentDir, file));
  if (!a.equals(b)) changed.push(file);
}

if (!changed.length && !added.length && !removed.length) {
  console.log(`\n✓ Identical: all ${baseFiles.size} captures match the baseline.`);
  process.exit(0);
}

/* Confirm before reporting.
 *
 * About one capture in a hundred still differs for reasons that are not the
 * CSS -- measured as a single flagged page across otherwise clean runs. A
 * real change is deterministic and survives a second look; that residue does
 * not. Only the captures that already differ are re-taken, so the cost is a
 * few seconds rather than a second full pass, and a guard that cries wolf
 * once a run is a guard that stops being read.
 */
if (changed.length) {
  const parse = (file) => {
    const [routePart, theme, widthPart] = file.replace(/\.png$/, '').split('__');
    const route = routes.find((r) => slug(r, theme, Number(widthPart)) === file);
    return route ? { route, theme, width: Number(widthPart) } : null;
  };
  const targets = changed.map(parse).filter(Boolean);
  if (targets.length) {
    console.log(`\nRe-checking ${targets.length} differing capture(s) to rule out render noise...`);
    const confirmDir = join(root, '.visual-confirm');
    const { cleanup: cleanup2 } = await startPreview({
      baseUrl,
      host,
      port,
      astroCli: join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'),
      allowReuse: reuse,
      reuseHint: 'VISUAL_REUSE_SERVER',
    });
    await capture(confirmDir, targets);
    cleanup2();
    const stillChanged = changed.filter((file) => {
      const confirmed = join(confirmDir, file);
      if (!existsSync(confirmed)) return true;
      return !readFileSync(join(baselineDir, file)).equals(readFileSync(confirmed));
    });
    const dropped = changed.length - stillChanged.length;
    if (dropped) console.log(`  ${dropped} settled on re-capture and were not real.`);
    rmSync(confirmDir, { recursive: true, force: true });
    changed.length = 0;
    changed.push(...stillChanged);
  }
}

if (!changed.length && !added.length && !removed.length) {
  console.log(`\n✓ Identical: all ${baseFiles.size} captures match the baseline.`);
  process.exit(0);
}

// Copy the differing pairs somewhere a human can open them side by side.
rmSync(diffDir, { recursive: true, force: true });
mkdirSync(diffDir, { recursive: true });
for (const file of changed) {
  writeFileSync(join(diffDir, `BEFORE__${file}`), readFileSync(join(baselineDir, file)));
  writeFileSync(join(diffDir, `AFTER__${file}`), readFileSync(join(currentDir, file)));
}

console.error(`\n✗ ${changed.length} capture(s) differ from the baseline:`);
for (const file of changed) console.error(`   ${file}`);
if (added.length) console.error(`\n  new captures (route added?): ${added.join(', ')}`);
if (removed.length) console.error(`\n  missing captures (route removed?): ${removed.join(', ')}`);
console.error(`\nBefore/after pairs written to ${diffDir.replace(root, '.')} — open them and decide.`);
console.error('If the change is the one you intended, re-run `record` to move the baseline.');
process.exit(1);
