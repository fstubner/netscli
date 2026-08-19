/**
 * Drive msedgedriver directly against the built Tauri app, bypassing
 * tauri-driver, with verbose logging on.
 *
 * Why this exists: the render harness fails with selenium's
 * "session not created: DevToolsActivePort file doesn't exist", which
 * only means "the thing I launched never exposed a debug port". Neither
 * selenium nor tauri-driver relays msedgedriver's own reasoning — we
 * confirmed tauri-driver captures no output at all on this path. Talking
 * to msedgedriver directly, with --verbose, is the only way to see what
 * it actually tried.
 *
 * Run:  node e2e/tauri-render/diagnose-driver.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { findApplication, resolveNativeDriverPath } from './driver.mjs';

const LOG_PATH = 'msedgedriver-verbose.log';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await delay(250);
  }
  throw new Error(`msedgedriver never listened on ${port}`);
}

/** Ask msedgedriver for a session, the same way tauri-driver would. */
async function trySession(port, label, capabilities) {
  console.log(`\n=== attempt: ${label} ===`);
  console.log(JSON.stringify(capabilities, null, 2));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities }),
    });
    const text = await response.text();
    console.log(`HTTP ${response.status}`);
    console.log(text.slice(0, 1200));
    if (response.ok) {
      const sessionId = JSON.parse(text)?.value?.sessionId;
      if (sessionId) {
        console.log(`SUCCESS — sessionId ${sessionId}; closing it again`);
        await fetch(`http://127.0.0.1:${port}/session/${sessionId}`, { method: 'DELETE' }).catch(
          () => undefined,
        );
        return true;
      }
    }
  } catch (error) {
    console.log(`request failed: ${error.message}`);
  }
  return false;
}

const application = findApplication();
const driverPath = await resolveNativeDriverPath();
const port = await freePort();

console.log(`app         : ${application}`);
console.log(`msedgedriver: ${driverPath}`);
console.log(`port        : ${port}`);

fs.rmSync(LOG_PATH, { force: true });

const driver = spawn(
  driverPath,
  [`--port=${port}`, '--verbose', `--log-path=${LOG_PATH}`, '--allowed-ips=', '--allowed-origins=*'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

// No initialiser: the first `trySession` below always assigns before anything
// reads this, and if `waitForPort` throws first the process exits from the
// `finally` without reaching the read.
let succeeded;
try {
  await waitForPort(port);

  // The shape tauri-driver uses for a Tauri app on Windows: point
  // msedgedriver at the app binary and tell it this is a WebView2 host.
  succeeded = await trySession(port, 'browserName=webview2 + ms:edgeOptions.binary', {
    alwaysMatch: {
      browserName: 'webview2',
      'ms:edgeOptions': { binary: application, args: [] },
    },
  });

  if (!succeeded) {
    // If the app is never given a remote-debugging-port it cannot write
    // a DevToolsActivePort file at all. wry forwards this env var into
    // the WebView2 host, so pass it explicitly and see if that is the
    // missing piece.
    succeeded = await trySession(port, 'webview2 + explicit remote-debugging-port', {
      alwaysMatch: {
        browserName: 'webview2',
        'ms:edgeOptions': {
          binary: application,
          args: ['--remote-debugging-port=9222'],
        },
      },
    });
  }
} finally {
  driver.kill();
  await delay(500);
  console.log(`\n=== ${LOG_PATH} ===`);
  if (fs.existsSync(LOG_PATH)) {
    const log = fs.readFileSync(LOG_PATH, 'utf8');
    console.log(log.length > 20_000 ? `${log.slice(0, 20_000)}\n…truncated…` : log);
  } else {
    console.log('(msedgedriver wrote no log file)');
  }
}

console.log(`\nresult: ${succeeded ? 'a session WAS created' : 'no session could be created'}`);
