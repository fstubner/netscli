import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.A11Y_HOST || '127.0.0.1';
const port = process.env.A11Y_PORT || '4322';
const baseUrl = process.env.A11Y_BASE_URL || `http://${host}:${port}`;
const defaultRoutes = [
  '/',
  '/docs/',
  '/docs/install/',
  '/docs/interface-coverage/',
  '/docs/desktop/',
  '/changelog/',
  '/404.html',
];

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

function runAxe() {
  const axeArgs = [
    ...urls,
    '--tags',
    'wcag2a,wcag2aa,wcag21a,wcag21aa',
    '--exit',
    '--load-delay',
    '300',
  ];

  if (process.env.A11Y_CHROME_OPTIONS) {
    axeArgs.push('--chrome-options', process.env.A11Y_CHROME_OPTIONS);
  }

  console.log(`Running axe on ${urls.length} route(s):`);
  urls.forEach((url) => console.log(`- ${url}`));

  return new Promise((resolve) => {
    const axe = spawn(process.execPath, [axeCli, ...axeArgs], { stdio: 'inherit' });
    axe.on('close', resolve);
  });
}

await ensurePreview();
const exitCode = await runAxe();
cleanup();
process.exit(exitCode ?? 1);
