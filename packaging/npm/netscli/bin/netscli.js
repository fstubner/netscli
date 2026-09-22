#!/usr/bin/env node
/* Launcher for the platform-specific netscli binary.
 *
 * `netscli` on npm carries no binary of its own. It declares one
 * `netscli-<platform>-<arch>` package per target as an optional dependency,
 * each with matching `os`/`cpu` fields, so npm installs exactly the one that
 * runs here and skips the rest. This file finds it and execs it.
 *
 * Why a JS launcher rather than a postinstall that copies the binary into
 * place: a postinstall does not run under `npm ci --ignore-scripts`, which
 * is the default in a fair number of CI setups and in some corporate npm
 * configs. A package whose binary silently fails to appear under a common
 * install flag is worse than one extra process in front of it.
 *
 * The cost is real and worth naming: every `netscli` invocation through npm
 * pays Node's startup. For `netscli serve` that is once per MCP session and
 * irrelevant. For someone scanning in a shell loop it is not, which is part
 * of why the docs point anyone who already has netscli installed at the
 * binary on their PATH instead of at npx.
 */

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

// The same string the platform packages are named with, and the same one
// their `os`/`cpu` fields are written from. process.platform is already
// npm's `os` vocabulary ('win32', 'darwin', 'linux') and process.arch is
// already its `cpu` vocabulary ('x64', 'arm64'), so no mapping is needed --
// which is the reason the packages are named this way.
const pkg = `netscli-${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'netscli.exe' : 'netscli';

function resolveBinary() {
  try {
    // Resolve via package.json rather than the binary path directly: a
    // package's own files are not necessarily exposed through `exports`,
    // and package.json always is.
    return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), exe);
  } catch {
    return null;
  }
}

const binary = resolveBinary();

if (binary === null) {
  process.stderr.write(
    `netscli: no prebuilt binary for ${process.platform}-${process.arch}.\n` +
      `\n` +
      `The package '${pkg}' is not installed. Either npm skipped it as an\n` +
      `optional dependency (a failed or partial install, or --no-optional),\n` +
      `or this platform is not one netscli publishes to npm.\n` +
      `\n` +
      `Published targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64,\n` +
      `win32-x64. Every other target, and the packet-capture builds, install\n` +
      `from https://netscli.com/docs/install/ instead.\n`,
  );
  process.exit(1);
}

/* stdio: 'inherit' is load-bearing, not a default worth changing.
 *
 * `netscli serve` speaks MCP over stdin/stdout, so the client's pipes have
 * to reach the real process. Piping through Node here would add a buffering
 * layer between a JSON-RPC writer and its reader for no benefit. */
const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });

/* Forward the signals a supervising MCP client actually sends, so the
 * scanner shuts down rather than being orphaned when the client goes away.
 * Node ignores these on Windows, where the child is killed with the
 * process group instead -- there is nothing to do there and nothing to
 * guard against. */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (err) => {
  process.stderr.write(`netscli: could not start ${binary}: ${err.message}\n`);
  process.exit(1);
});

/* Reproduce the child's exit faithfully. A process killed by a signal has
 * code === null, and reporting that as 0 would tell a caller the scan
 * succeeded. 128 + signal number is the shell convention for the same
 * thing, and is what a caller running the binary directly would have seen. */
child.on('exit', (code, signal) => {
  if (code !== null) {
    process.exit(code);
  }
  const numbers = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };
  process.exit(128 + (numbers[signal] ?? 0));
});
