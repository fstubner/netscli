import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download as downloadEdgeDriver } from 'edgedriver';
import webdriver from 'selenium-webdriver';

import { guiRoot, repoRoot } from './paths.mjs';
import { waitForPort } from './processes.mjs';

export const { Builder, By, Key, until } = webdriver;

/**
 * Why this harness attaches instead of letting the driver launch the app.
 *
 * `tauri-driver` asks msedgedriver to start the app as if it were Edge.
 * msedgedriver passes `--remote-debugging-port=0`, then reads the port it
 * was given back out of a `DevToolsActivePort` file inside the temporary
 * `--user-data-dir` it created for the session.
 *
 * wry does not use that directory. It puts the WebView2 profile in Tauri's
 * own folder, keyed on the app identifier -- on Windows
 * `%LOCALAPPDATA%\<identifier>\EBWebView\` -- and writes `DevToolsActivePort`
 * there. The driver looks in its own directory, finds nothing, and after 60
 * seconds reports "session not created: DevToolsActivePort file doesn't
 * exist". The file exists; it is simply somewhere the driver never looks.
 * That is why every run of this suite has failed, and why the error never
 * pointed anywhere useful.
 *
 * Attaching sidesteps the whole exchange: we start the app ourselves on a
 * port we chose, and hand the driver `debuggerAddress`, which tells it to
 * connect to something already running rather than launch anything. No
 * DevToolsActivePort lookup happens at all.
 *
 * The cost is that an attached session reports `setWindowRect: false`, so
 * `driver.manage().window().setRect()` is unavailable -- see `setViewport`.
 */

export async function resolveNativeDriverPath() {
  return process.env.TAURI_NATIVE_DRIVER ?? (await downloadEdgeDriver());
}

export function findApplication() {
  if (process.env.TAURI_APP_PATH) {
    return path.resolve(process.env.TAURI_APP_PATH);
  }

  const appName = process.platform === 'win32' ? 'netscli-gui.exe' : 'netscli-gui';
  const candidates = [
    process.env.CARGO_TARGET_DIR ? path.join(process.env.CARGO_TARGET_DIR, 'debug', appName) : null,
    path.join(repoRoot, 'target', 'debug', appName),
    path.join(guiRoot, 'src-tauri', 'target', 'debug', appName),
  ].filter(Boolean);
  const application = candidates.find((candidate) => fs.existsSync(candidate));
  if (!application) {
    throw new Error(`Could not find debug Tauri app binary. Checked: ${candidates.join(', ')}`);
  }
  return application;
}

/**
 * Start the app under test with a remote debugging port we control.
 *
 * wry forwards `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` into the WebView2
 * host, which is how a fixed port gets requested. A fixed port is the point:
 * it removes any need to discover one from a file.
 */
export async function launchApplication(application, debugPort) {
  // A profile of its own, per run. WebView2 otherwise reuses one folder for
  // the identifier, so `localStorage` -- and with it the app's saved history
  // and preferences -- survives between runs and leaks in from any ordinary
  // use of the app on the same machine. The first real run of this suite
  // failed on exactly that: the History menu held nine entries from earlier
  // manual launches where the assertion expected the one scan it had just
  // performed.
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netscli-e2e-profile-'));

  const child = spawn(application, [], {
    cwd: guiRoot,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
      WEBVIEW2_USER_DATA_FOLDER: profileDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getOutput = () => output;
  child.profileDir = profileDir;

  await Promise.race([
    waitForPort(debugPort, 60_000),
    new Promise((_, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`app exited before opening its debug port (${code ?? signal})\n${output}`));
      });
    }),
  ]);

  return child;
}

/** Run the platform WebDriver directly; `tauri-driver` is not in the path. */
export async function startNativeDriver(nativeDriverPath, webdriverPort) {
  let output = '';
  const child = spawn(
    nativeDriverPath,
    [`--port=${webdriverPort}`, '--allowed-ips=', '--allowed-origins=*'],
    { cwd: guiRoot, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' },
  );

  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getDriverOutput = () => output;

  await Promise.race([
    waitForPort(webdriverPort),
    new Promise((_, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`native driver exited early with ${code ?? signal}\n${output}`));
      });
    }),
  ]);

  return child;
}

export async function createDriver(webdriverPort, debugPort) {
  return new Builder()
    .usingServer(`http://127.0.0.1:${webdriverPort}/`)
    .withCapabilities({
      browserName: 'webview2',
      'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${debugPort}` },
    })
    .build();
}

/**
 * Resize the page's viewport.
 *
 * The replacement for `driver.manage().window().setRect()`, which an
 * attached session refuses (`setWindowRect: false`). Selenium's own CDP
 * passthrough is not available either -- `sendDevToolsCommand` is undefined
 * on the generic driver this returns -- so this speaks CDP directly over the
 * debug port we already have.
 *
 * `Emulation.setDeviceMetricsOverride` changes what the page believes its
 * viewport is, which is what the responsive assertions actually test. It
 * does not move the OS window, so a screenshot still shows the real frame.
 */
export async function setViewport(debugPort, { width, height }) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Global WebSocket is required to resize the viewport; use Node 22.4 or newer.');
  }

  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) {
    throw new Error(`No CDP page target on port ${debugPort}; found: ${JSON.stringify(targets.map((t) => t.type))}`);
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('CDP websocket failed to open'));
    });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP setDeviceMetricsOverride timed out')), 10_000);
      socket.onmessage = (message) => {
        const data = JSON.parse(message.data);
        if (data.id !== 1) return;
        clearTimeout(timer);
        resolve(data);
      };
      socket.send(JSON.stringify({
        id: 1,
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width, height, deviceScaleFactor: 1, mobile: false },
      }));
    });
    if (reply.error) {
      throw new Error(`CDP setDeviceMetricsOverride failed: ${JSON.stringify(reply.error)}`);
    }
  } finally {
    socket.close();
  }
}
