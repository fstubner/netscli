/* Shared plumbing for checks that run against the BUILT site.
 *
 * Extracted from a11y.mjs when visual-fingerprint.mjs needed the same three
 * things. Every comment below records a bug that was actually hit; a second
 * hand-written copy of this logic would have re-hit them one at a time, which
 * is the whole reason it lives in one place now.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Every route the build actually produced.
 *
 * Derived from dist/ rather than hard-coded (B-26). The hard-coded list
 * covered 7 of 14 routes, and the seven it missed -- /docs/cli/, /mcp/,
 * /tui/, /operations/, /packet-capture/, /core-library/, /result-model/ --
 * hold the heaviest table markup. A list maintained by hand is exactly the
 * list that drifts as pages are added.
 *
 * Returns null when dist/ is absent so the caller can decide whether that is
 * fatal; an empty list would let a check pass having scanned nothing.
 */
export function discoverRoutes(cwd = process.cwd()) {
  const dist = join(cwd, 'dist');
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

/** PIDs listening on `port`, on either platform. */
function listenersOnPort(port) {
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return [];
    return [
      ...new Set(
        r.stdout
          .split(/\r?\n/)
          .filter((line) => line.includes('LISTENING') && line.includes(':' + port))
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && pid !== '0'),
      ),
    ];
  }
  const r = spawnSync('lsof', ['-ti', 'tcp:' + port], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return [];
  return [...new Set(r.stdout.split(/\s+/).filter(Boolean))];
}

/**
 * Start `astro preview`, or refuse if the port is already taken.
 *
 * Returns a `{ cleanup }` handle. The caller must invoke it; the process
 * hooks below also run it, so an interrupted run does not leak the server.
 *
 * @param {object} options
 * @param {string} options.baseUrl   e.g. http://127.0.0.1:4322
 * @param {string} options.host
 * @param {string} options.port
 * @param {string} options.astroCli  path to astro's bin
 * @param {boolean} options.allowReuse  honour the caller's REUSE env opt-in
 * @param {string} options.reuseHint    env var name to name in the message
 */
export async function startPreview({ baseUrl, host, port, astroCli, allowReuse, reuseHint }) {
  let preview;
  let previewOutput = '';

  // Cleanup kills whatever is listening on our port, not `preview.pid`.
  //
  // `preview.kill()` leaked the server on every run, and a tree-walk fix
  // did not help either: `taskkill /T` exited 128 ("process not found").
  // The node process we spawn re-execs and exits, so the process actually
  // holding the port is an orphan whose parent is already gone -- there is
  // no tree left to walk from `preview.pid`.
  //
  // The leak was not cosmetic. The next run hit the "already listening"
  // guard below and exited 1, so the check reliably blocked itself on its
  // second invocation.
  //
  // Killing by port is safe precisely because of that guard: we only reach
  // here having confirmed the port was free and started the server
  // ourselves, so nothing else can own it.
  const cleanup = () => {
    if (!preview) return;
    for (const pid of listenersOnPort(port)) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
      } else {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
    if (!preview.killed) preview.kill();
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

  const isServing = async () => {
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
      return response.status < 500;
    } catch {
      return false;
    }
  };

  if (await isServing()) {
    // Reusing whatever answers on this port is how a green local run stops
    // meaning anything. A long-running `astro dev` server also listens on
    // 4322 and serves from source with different CSS processing, so the gate
    // silently checked something other than dist/ -- and passed while CI,
    // which always starts fresh, failed on a 1.53:1 contrast bug.
    if (allowReuse) {
      console.log(`Reusing the server already at ${baseUrl} (${reuseHint}=1).`);
      console.log('Note: this is only valid if it is serving the current dist/.');
      return { cleanup };
    }
    console.error(
      `Something is already listening on ${baseUrl}.\n` +
        'Refusing to use it, because a dev server serves different output than\n' +
        'the production build and would make this check pass on the wrong thing.\n' +
        `Stop it, or set ${reuseHint}=1 if it is serving the current dist/.`,
    );
    process.exit(1);
  }

  // Something can hold the port without answering on ours.
  //
  // `astro preview` run by hand daemonises and binds `localhost`, which
  // resolves to ::1 first on Windows; these checks wait on 127.0.0.1. So the
  // probe above says "free", the spawn below cannot bind, and the run ends
  // 30 seconds later with a timeout that names the wrong problem -- it looks
  // like a broken build rather than a stray server. That cost three
  // debugging detours in one afternoon before it was written down.
  const squatters = listenersOnPort(port);
  if (squatters.length) {
    console.error(
      `Port ${port} is taken by another process (pid ${squatters.join(', ')}), ` +
        `but it is not answering on ${baseUrl}.\n\n` +
        'A hand-started `astro preview` binds localhost (::1) rather than\n' +
        '127.0.0.1, which looks exactly like this. Stop it with\n' +
        '`npx astro preview stop`, or free the port some other way, then run\n' +
        'this again.',
    );
    process.exit(1);
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

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServing()) return { cleanup };
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}\n${previewOutput}`);
}

/**
 * ChromeDriver has to match the installed Chrome's major version exactly.
 * The `chromedriver` npm package fetches whatever is newest at install
 * time -- so the day ChromeDriver 151 ships and the runner image still has
 * Chrome 150, every run dies with "session not created". Nothing about the
 * site changed; the check just stops working.
 *
 * GitHub's Ubuntu images ship a matched pair and point `CHROMEWEBDRIVER` at
 * the directory holding the driver. Prefer that when it exists, and fall
 * back to whatever resolves locally.
 */
export function resolveChromedriverPath(explicitEnv) {
  const explicit = explicitEnv;
  const candidates = [
    explicit,
    process.env.CHROMEWEBDRIVER && join(process.env.CHROMEWEBDRIVER, 'chromedriver'),
    process.env.CHROMEWEBDRIVER && join(process.env.CHROMEWEBDRIVER, 'chromedriver.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  if (explicit) {
    console.warn(`Chromedriver path ${explicit} does not exist; ignoring.`);
  }
  return null;
}
