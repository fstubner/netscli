import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { download as downloadEdgeDriver } from 'edgedriver';
import webdriver from 'selenium-webdriver';

import { guiRoot, repoRoot, tauriDriverBin } from './paths.mjs';
import { waitForPort } from './processes.mjs';

export const { Builder, By, Key, until } = webdriver;

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

export async function startTauriDriver(nativeDriverPath, webdriverPort) {
  if (!fs.existsSync(tauriDriverBin)) {
    throw new Error(`tauri-driver was not found at ${tauriDriverBin}. Install it with: cargo install tauri-driver --locked`);
  }

  const args = ['--port', String(webdriverPort), '--native-driver', nativeDriverPath];
  let output = '';
  const child = spawn(tauriDriverBin, args, {
    cwd: guiRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    // Its own process group, so `stopProcess` can signal the whole tree.
    // tauri-driver spawns the platform WebDriver, which spawns the browser;
    // without this those grandchildren outlive the run and hold their ports
    // (M-13). No-op on Windows, which uses taskkill /T instead.
    detached: process.platform !== 'win32',
  });

  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  await Promise.race([
    waitForPort(webdriverPort),
    new Promise((_, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`tauri-driver exited early with ${code ?? signal}\n${output}`));
      });
    }),
  ]);

  // tauri-driver proxies to the native driver (msedgedriver on Windows)
  // and relays its diagnostics here. Previously this buffer was only
  // ever read if tauri-driver exited *early* — so when the far more
  // common failure happened instead (the session failing to start, e.g.
  // "DevToolsActivePort file doesn't exist"), everything the native
  // driver said about why was silently discarded. Expose it so the
  // caller can print it on any failure.
  child.getDriverOutput = () => output;

  return child;
}

export async function createDriver(webdriverPort, application) {
  return new Builder()
    .usingServer(`http://127.0.0.1:${webdriverPort}/`)
    .withCapabilities({
      browserName: 'wry',
      'tauri:options': { application },
    })
    .build();
}
