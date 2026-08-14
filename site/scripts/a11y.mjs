import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.A11Y_HOST || '127.0.0.1';
const port = process.env.A11Y_PORT || '4322';
const baseUrl = process.env.A11Y_BASE_URL || `http://${host}:${port}`;
// Derive the route list from what was actually built rather than hard-coding
// it (B-26). The hard-coded list covered 7 of 14 routes, and the seven it
// missed -- /docs/cli/, /mcp/, /tui/, /operations/, /packet-capture/,
// /core-library/, /result-model/ -- hold the heaviest table markup, which
// docs-header.ts then wraps at runtime on every docs page. A list that has to
// be updated by hand is exactly the list that drifts as pages are added.
function discoverRoutes() {
  const dist = join(process.cwd(), 'dist');
  if (!existsSync(dist)) return null;

  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}/`);
      } else if (entry.name === 'index.html') {
        found.push(prefix || '/');
      } else if (entry.name.endsWith('.html')) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(dist, '/');
  return found.sort();
}

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

let preview;
let previewOutput = '';

const cleanup = () => {
  if (preview && !preview.killed) preview.kill();
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

async function isServing() {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServing()) return;
    await delay(500);
  }

  throw new Error(`Timed out waiting for ${baseUrl}\n${previewOutput}`);
}

async function ensurePreview() {
  if (await isServing()) {
    console.log(`Using existing preview server at ${baseUrl}`);
    return;
  }

  console.log(`Starting Astro preview at ${baseUrl}`);
  preview = spawn(process.execPath, [astroCli, 'preview', '--host', host, '--port', port], {
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  preview.stdout.on('data', (chunk) => {
    previewOutput += chunk.toString();
  });
  preview.stderr.on('data', (chunk) => {
    previewOutput += chunk.toString();
  });

  await waitForServer();
}

/**
 * The site has a light and a dark theme with SEPARATE colour tokens, and
 * Starlight picks one from `prefers-color-scheme`. That made this check
 * silently environment-dependent: it only ever tested whichever theme
 * the runner's Chrome happened to prefer. A developer on a dark-mode OS
 * got a clean run while CI (Ubuntu, no preference, so light) failed —
 * light-theme contrast bugs could sit unnoticed behind a green local
 * check. Run both explicitly.
 *
 * Chrome has no "force light" switch because light IS the default with
 * no OS preference; `--force-dark-mode` covers the other side.
 */
const THEMES = [
  { name: 'light', chromeOptions: [] },
  { name: 'dark', chromeOptions: ['force-dark-mode'] },
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
function resolveChromedriverPath() {
  const explicit = process.env.A11Y_CHROMEDRIVER_PATH;
  const candidates = [
    explicit,
    process.env.CHROMEWEBDRIVER && join(process.env.CHROMEWEBDRIVER, 'chromedriver'),
    process.env.CHROMEWEBDRIVER && join(process.env.CHROMEWEBDRIVER, 'chromedriver.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  if (explicit) {
    console.warn(`A11Y_CHROMEDRIVER_PATH is set but ${explicit} does not exist; ignoring.`);
  }
  return null;
}

const chromedriverPath = resolveChromedriverPath();
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

await ensurePreview();

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
