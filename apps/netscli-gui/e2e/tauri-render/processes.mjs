import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

export function stopProcess(child) {
  if (child && !child.killed) {
    child.kill();
  }
}
