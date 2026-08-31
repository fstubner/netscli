import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { discoverRoutes, startPreview, resolveChromedriverPath } from './lib/preview-server.mjs';

const host = process.env.A11Y_HOST || '127.0.0.1';
const port = process.env.A11Y_PORT || '4322';
const baseUrl = process.env.A11Y_BASE_URL || `http://${host}:${port}`;
// Falls back to the previous list only if dist/ is missing, so a caller who
// forgot to build still gets a meaningful run instead of scanning nothing --
// an empty route list would otherwise pass silently.
const fallbackRoutes = [
  '/',
  '/docs/',
  '/docs/install/',
  '/docs/interface-coverage/',
  '/docs/desktop/',
  '/changelog/',
  '/404.html',
];
const defaultRoutes = discoverRoutes() ?? fallbackRoutes;

const routes = (process.env.A11Y_ROUTES || defaultRoutes.join(' '))
  .split(/[\s,]+/)
  .map((route) => route.trim())
  .filter(Boolean);

const urls = routes.map((route) => new URL(route, baseUrl).href);
const modulePath = (...segments) => join(process.cwd(), 'node_modules', ...segments);
const astroCli = modulePath('astro', 'bin', 'astro.mjs');
const axeCli = modulePath('@axe-core', 'cli', 'dist', 'src', 'bin', 'cli.js');

/**
 * The site has a light and a dark theme with SEPARATE colour tokens, and
 * Starlight picks one from `prefers-color-scheme`. That made this check
 * silently environment-dependent: it only ever tested whichever theme
 * the runner's Chrome happened to prefer. A developer on a dark-mode OS
 * got a clean run while CI (Ubuntu, no preference, so light) failed —
 * light-theme contrast bugs could sit unnoticed behind a green local
 * check. Run both explicitly.
 *
 * Both passes name the preference outright. The light pass used to pass no
 * flag at all, on the reasoning that light IS the default when the runner
 * has no OS preference -- true on Ubuntu, false on a workstation, where
 * Chrome inherits the OS setting. On a dark-mode desktop that made BOTH
 * passes render dark and report a clean run, which is the same
 * environment-dependence this block was written to remove, just moved one
 * step along. It cost a false green: two pages were reported as passing in
 * both themes while CI had been failing them on 23 and 10 contrast
 * violations.
 *
 * `blink-settings=preferredColorScheme` sets what `prefers-color-scheme`
 * reports (1 = light, 2 = dark), which is the thing the site actually reads.
 * `--force-dark-mode` is not that: it is Chrome's automatic darkening of
 * pages that have no dark theme, so it re-tints an already-dark page and
 * tests colours nobody wrote. The visual harness dropped it for the same
 * reason.
 */
// `headless` is not optional here. Without it, axe launches a headed Chrome
// that takes its colour scheme from the OS and overrides the flag above, so
// *both* passes render the same theme and one of them is never tested. That
// blind spot is not theoretical: it hid a 1.53:1 contrast failure in the
// caution callout on /docs/packet-capture/ from every local run, and only CI
// -- which is headless -- caught it.
//
// Sabotage-checked in both directions on a dark-mode workstation, against a
// light theme deliberately broken by restoring the dark accent: the old
// unflagged light pass reported 0 violations and exited 0; this one reports
// 6 and exits 1.
const THEMES = [
  { name: 'light', chromeOptions: ['headless', 'blink-settings=preferredColorScheme=1'] },
  { name: 'dark', chromeOptions: ['headless', 'blink-settings=preferredColorScheme=2'] },
];

/**
 * ChromeDriver has to match the installed Chrome's major version exactly.
 * `@axe-core/cli` pulls in the `chromedriver` npm package, which fetches
 * whatever is newest at install time — so the day ChromeDriver 151 ships
 * and the runner image still has Chrome 150, every run dies with
 * "session not created". Nothing about the site changed; the check just
 * stops working.
 *
 * GitHub's Ubuntu images ship a Chrome and a ChromeDriver that are
 * already matched, and point `CHROMEWEBDRIVER` at the directory holding
 * the latter. Prefer that when it exists, and fall back to whatever
 * axe resolves on its own (which is the right behaviour locally).
 */
const chromedriverPath = resolveChromedriverPath(process.env.A11Y_CHROMEDRIVER_PATH);
if (chromedriverPath) {
  console.log(`Using runner-matched chromedriver: ${chromedriverPath}`);
}

function runAxe({ name, chromeOptions }) {
  const axeArgs = [
    ...urls,
    '--tags',
    'wcag2a,wcag2aa,wcag21a,wcag21aa',
    '--exit',
    '--load-delay',
    '300',
  ];

  if (chromedriverPath) {
    axeArgs.push('--chromedriver-path', chromedriverPath);
  }

  const extraChromeOptions = process.env.A11Y_CHROME_OPTIONS
    ? process.env.A11Y_CHROME_OPTIONS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  const allChromeOptions = [...chromeOptions, ...extraChromeOptions];
  if (allChromeOptions.length) {
    axeArgs.push('--chrome-options', allChromeOptions.join(','));
  }

  console.log(`\n=== ${name} theme — ${urls.length} route(s) ===`);
  urls.forEach((url) => console.log(`- ${url}`));

  return new Promise((resolve) => {
    const axe = spawn(process.execPath, [axeCli, ...axeArgs], { stdio: 'inherit' });
    axe.on('close', resolve);
    // Without this a missing/renamed axe binary leaves the promise
    // pending and the job hangs until the CI timeout instead of failing.
    axe.on('error', (error) => {
      console.error(`Failed to start axe: ${error.message}`);
      resolve(1);
    });
  });
}

const { cleanup } = await startPreview({
  baseUrl,
  host,
  port,
  astroCli,
  allowReuse: process.env.A11Y_REUSE_SERVER === '1',
  reuseHint: 'A11Y_REUSE_SERVER',
});

let failed = false;
for (const theme of THEMES) {
  const code = await runAxe(theme);
  if (code !== 0) {
    failed = true;
    console.error(`\n✗ Accessibility violations in the ${theme.name} theme.`);
  }
}

cleanup();
if (failed) {
  process.exit(1);
}
console.log('\n✓ No accessibility violations in either theme.');
process.exit(0);
