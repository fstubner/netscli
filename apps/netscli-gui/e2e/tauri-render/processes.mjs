import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

import { guiRoot, npmBin } from './paths.mjs';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const childCommand = process.platform === 'win32' && command === npmBin ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const childArgs =
      process.platform === 'win32' && command === npmBin
        ? ['/d', '/s', '/c', [command, ...args].join(' ')]
        : args;
    const child = spawn(childCommand, childArgs, {
      cwd: options.cwd ?? guiRoot,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
      }
    });
  });
}

export async function getFreePort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address === 'object', 'Expected an ephemeral TCP port');
  return address.port;
}

export function waitForPort(port, timeoutMs = 20_000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(500);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('timeout', () => socket.destroy(new Error('Timed out')));
      socket.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 250);
        }
      });
    };

    tryConnect();
  });
}

/**
 * Kill a spawned process *and everything it spawned*.
 *
 * `child.kill()` alone signals only the direct child (M-13). The processes
 * this suite starts are supervisors — `tauri-driver` spawns the platform
 * WebDriver, which spawns the browser — so the grandchildren survived, kept
 * holding their ports, and the next run failed to bind or attached to a stale
 * session. On CI the job simply hung until its timeout.
 *
 * Windows has no process groups, so `taskkill /T` is the only way to walk the
 * tree; elsewhere, killing the negated pid signals the whole group, which is
 * why callers spawn detached.
 */
export function stopProcess(child) {
  if (!child || child.killed || child.pid === undefined) return;

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // Fall through to the plain kill below.
    }
  } else {
    try {
      // Negative pid = process group. Requires the child to be detached.
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // Not a group leader, or already gone.
    }
  }

  try {
    child.kill();
  } catch {
    // Already exited.
  }
}
