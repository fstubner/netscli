#!/usr/bin/env node
//
// Writes the third-party license notices that ship with NetsCLI:
//
//   THIRD-PARTY-NOTICES.txt                  the CLI and the desktop app. A
//                                            release asset, and installed with
//                                            the desktop app.
//   apps/netscli-cli/THIRD-PARTY-NOTICES.txt the CLI alone. Compiled into the
//                                            binary for `netscli licenses`.
//
//   node scripts/third-party-notices.mjs
//
// Needs cargo-about (the version ci.yml pins), the crates fetched
// (`cargo fetch --locked`), and `npm ci` in apps/netscli-gui. CI runs this and
// fails if either file changes, so a dependency update that lands without
// regenerating them is caught at review rather than shipped with stale notices.
//
// Why the CLI has a file of its own: crates.io packages only what is inside the
// crate's directory, so `include_str!` cannot reach the one at the root. It
// lists only the crates that build into the CLI, which also keeps the binary
// from carrying the desktop app's notices.
//
// Rust crates come from cargo-about, configured in about.toml and laid out by
// about.hbs. Only normal dependencies for the release targets are listed, with
// the features the release builds use. JavaScript packages are read straight
// from apps/netscli-gui/package-lock.json, because those are what Vite bundles
// into the app: every package npm would install without its dev dependencies.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guiDir = path.join(repoRoot, 'apps/netscli-gui');
const RULE = '='.repeat(80);
const LICENSE_FILE = /^(licen[cs]e|copying)/i;

/** Line endings and trailing blank lines normalised, so the output does not
 *  depend on how a crate or package happened to save its license file. */
function normalise(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n';
}

function cargoAbout(args) {
  const result = spawnSync(
    'cargo',
    ['about', 'generate', '--fail', '--frozen', '-c', 'about.toml', 'about.hbs', ...args],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw new Error(`could not run cargo about: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`cargo about ${args.join(' ')} exited with ${result.status}`);
  }
  return normalise(result.stdout);
}

/** The packages Vite can bundle: everything in the lockfile that is not a
 *  dev dependency. `devOptional` ones are excluded too. They are dev
 *  dependencies that a production package names only as an optional peer
 *  (lucide-react and @types/react), so a production install leaves them out. */
function productionPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(guiDir, 'package-lock.json'), 'utf8'));
  return Object.entries(lock.packages)
    .filter(([key, meta]) => key.startsWith('node_modules/') && !meta.dev && !meta.devOptional)
    .map(([key, meta]) => ({
      dir: path.join(guiDir, key),
      name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: meta.version,
      license: meta.license ?? 'no license field',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function npmSection() {
  const packages = productionPackages();
  if (packages.length === 0) throw new Error('package-lock.json lists no production packages');
  // One entry per distinct license text, in the order first seen.
  const texts = new Map();
  const missing = [];
  for (const pkg of packages) {
    if (!fs.existsSync(pkg.dir)) {
      throw new Error(`${pkg.name} is not installed. Run \`npm ci --ignore-scripts\` in apps/netscli-gui.`);
    }
    const files = fs
      .readdirSync(pkg.dir)
      .filter((file) => LICENSE_FILE.test(file))
      .sort();
    if (files.length === 0) missing.push(`${pkg.name} ${pkg.version}`);
    for (const file of files) {
      const text = normalise(fs.readFileSync(path.join(pkg.dir, file), 'utf8'));
      if (!texts.has(text)) texts.set(text, { files: new Set(), users: [] });
      const entry = texts.get(text);
      entry.files.add(file);
      entry.users.push(pkg);
    }
  }
  if (missing.length > 0) {
    throw new Error(`no license file in these production packages:\n  ${missing.join('\n  ')}`);
  }

  const lines = ['Packages:', ''];
  for (const pkg of packages) lines.push(`  ${pkg.name} ${pkg.version} (${pkg.license})`);
  lines.push('', 'Packages that ship the same license file share one copy of it.');
  for (const [text, { files, users }] of texts) {
    lines.push('', RULE, [...files].join(', '), RULE, '', 'Used by:');
    for (const pkg of users) {
      lines.push(`  ${pkg.name} ${pkg.version}`, `    https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`);
    }
    lines.push('', text.trimEnd());
  }
  return lines.join('\n') + '\n';
}

function header(title, covers, rust) {
  const lines = [
    title,
    '',
    'NetsCLI itself is MIT licensed, under the LICENSE file in its repository at',
    'https://github.com/fstubner/netscli.',
    '',
    ...covers,
  ];
  if (rust.includes('(MPL-2.0)')) {
    lines.push(
      '',
      'The crates under the Mozilla Public License 2.0 are used unmodified. The',
      'source of each one is on crates.io at the address listed with it.',
    );
  }
  lines.push('', 'Generated by scripts/third-party-notices.mjs. Do not edit by hand.', '');
  return lines.join('\n');
}

function part(title, body) {
  return `\n${RULE}\n${RULE}\n${title}\n${RULE}\n${RULE}\n\n${body}`;
}

function write(relative, text) {
  fs.writeFileSync(path.join(repoRoot, relative), text);
  console.log(`wrote ${relative} (${Buffer.byteLength(text)} bytes)`);
}

// The pcap feature, because the -pcap release builds ship too. custom-protocol
// is what `tauri build` turns on.
const cliRust = cargoAbout(['--manifest-path', 'apps/netscli-cli/Cargo.toml', '--features', 'pcap']);
const allRust = cargoAbout(['--workspace', '--features', 'netscli/pcap netscli-gui/custom-protocol']);
const npm = npmSection();

write(
  'THIRD-PARTY-NOTICES.txt',
  header(
    'Third-party notices for NetsCLI',
    [
      'The netscli command-line tool and the NetsCLI desktop app are built from the',
      'open source components listed here, which are used under the licenses that',
      'follow.',
    ],
    allRust,
  ) +
    part('Rust crates in netscli and the NetsCLI desktop app', allRust) +
    part('JavaScript packages in the NetsCLI desktop app', npm),
);
write(
  'apps/netscli-cli/THIRD-PARTY-NOTICES.txt',
  header(
    'Third-party notices for netscli',
    [
      'The netscli command-line tool is built from the open source components listed',
      'here, which are used under the licenses that follow.',
    ],
    cliRust,
  ) +
    part('Rust crates in netscli', cliRust),
);
