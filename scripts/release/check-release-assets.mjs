/* Check that a draft release carries everything a release needs, before
 * publish-release.yml makes it public.
 *
 *   node scripts/release/check-release-assets.mjs vX.Y.Z <assets.jsonl> <sidecar-dir> <latest.json>
 *
 * publish-release.yml fetches the three inputs with `gh` and this decides:
 *
 *   <assets.jsonl>  the release's assets from the GitHub API, one
 *                   {name, size, digest} object per line
 *   <sidecar-dir>   the release's `.sha256` files
 *   <latest.json>   the release's own copy of the updater manifest
 *
 * Why it exists: a release used to go public before its files did. v0.3.4
 * had no Windows installer and no latest.json for 1 h 38 min after it was
 * published. In that time install.ps1 and the in-app updater found
 * nothing, and the publish jobs that needed the Windows files failed. Now
 * the release is built as a draft and stays one until this passes, so
 * "public" means "complete".
 *
 * What it checks, for each of the 18 files release.yml builds: the file
 * and its .sha256, .sig and .pem are all there and none is empty, and the
 * .sha256 names the digest GitHub computed for the uploaded file. A re-run
 * that replaced a file but failed to replace its sidecar would otherwise
 * publish a checksum that every installer then rejects. And latest.json is
 * there, announces this version, points every platform at this tag, and
 * carries signatures bound to this version, as the app requires.
 *
 * What it does not check is whether the signatures verify. sign-windows
 * checks every Authenticode signature with osslsigncode, and the
 * updater-manifest job checks every updater signature against the app's
 * public key, before either uploads anything. The Sigstore .sig and .pem
 * files are checked for presence only.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { UPDATE_ASSETS, signedVersion } from './updater-manifest.mjs';

/** Every file release.yml builds. Each ships with the three SIDECARS. */
export const ARTIFACTS = [
  // The `release` matrix: the CLI.
  'netscli-linux-x86_64',
  'netscli-linux-x86_64-pcap',
  'netscli-linux-x86_64-musl',
  'netscli-linux-aarch64',
  'netscli-linux-aarch64-pcap',
  'netscli-windows-x86_64.exe',
  'netscli-windows-x86_64-pcap.exe',
  'netscli-macos-x86_64',
  'netscli-macos-x86_64-pcap',
  'netscli-macos-aarch64',
  'netscli-macos-aarch64-pcap',
  // The `gui` matrix: the desktop app. The .app.tar.gz files are what the
  // macOS updater installs from.
  'netscli-gui-linux-x86_64.deb',
  'netscli-gui-linux-x86_64.AppImage',
  'netscli-gui-macos-aarch64.dmg',
  'netscli-gui-macos-x86_64.dmg',
  'netscli-gui-macos-aarch64.app.tar.gz',
  'netscli-gui-macos-x86_64.app.tar.gz',
  'netscli-gui-windows-x86_64.msi',
];

export const SIDECARS = ['.sha256', '.sig', '.pem'];

const HEX64 = /^[0-9a-f]{64}$/;

/** The problems with a draft, as sentences. Empty means it can go public. */
export function checkReleaseAssets({ tag, assets, sidecars, latest }) {
  const problems = [];
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const version = tag.replace(/^v/, '');

  for (const artifact of ARTIFACTS) {
    for (const name of [artifact, ...SIDECARS.map((suffix) => `${artifact}${suffix}`)]) {
      const asset = byName.get(name);
      if (!asset) problems.push(`${name} is missing`);
      else if (!(asset.size > 0)) problems.push(`${name} is empty`);
    }

    const asset = byName.get(artifact);
    if (!asset || !byName.has(`${artifact}.sha256`)) continue;
    const sidecar = sidecars[`${artifact}.sha256`];
    if (sidecar === undefined) {
      problems.push(`${artifact}.sha256 could not be read`);
      continue;
    }
    const claimed = (sidecar.trim().split(/\s+/)[0] ?? '').toLowerCase();
    const actual = (/^sha256:(.*)$/.exec(asset.digest ?? '')?.[1] ?? '').toLowerCase();
    if (!HEX64.test(claimed)) {
      problems.push(`${artifact}.sha256 holds no SHA-256 digest`);
    } else if (!HEX64.test(actual)) {
      problems.push(`GitHub reports no SHA-256 digest for ${artifact}`);
    } else if (claimed !== actual) {
      problems.push(`${artifact}.sha256 says ${claimed}, but the uploaded file is ${actual}`);
    }
  }

  if (!byName.has('latest.json')) {
    problems.push('latest.json is missing');
  } else if (!latest) {
    problems.push('latest.json could not be read');
  } else {
    if (latest.version !== version) {
      problems.push(`latest.json announces ${latest.version}, not ${version}`);
    }
    for (const [key, asset] of Object.entries(UPDATE_ASSETS)) {
      const entry = latest.platforms?.[key];
      if (!entry) {
        problems.push(`latest.json has no ${key} entry`);
        continue;
      }
      if (typeof entry.url !== 'string' || !entry.url.endsWith(`/releases/download/${tag}/${asset}`)) {
        problems.push(`latest.json sends ${key} to ${entry.url}, not to ${asset} on ${tag}`);
      }
      if (typeof entry.signature !== 'string' || entry.signature.trim() === '') {
        problems.push(`latest.json has no signature for ${key}`);
        continue;
      }
      // The app sets requireSignedVersion, so a signature bound to no
      // version, or to another one, is an update it refuses.
      const signed = signedVersion(entry.signature);
      if (signed?.replace(/^v/, '') !== version) {
        problems.push(`latest.json's ${key} signature is bound to ${signed ?? 'no version'}, not ${version}`);
      }
    }
  }

  return problems;
}

/** Assets on the release that nothing here expects. Reported, not failed:
 *  an extra file breaks nothing, but it usually means a name changed. */
export function unexpectedAssets(assets) {
  const expected = new Set([
    'latest.json',
    ...ARTIFACTS.flatMap((artifact) => [artifact, ...SIDECARS.map((suffix) => `${artifact}${suffix}`)]),
  ]);
  return assets.map((asset) => asset.name).filter((name) => !expected.has(name));
}

function readInputs(tag, assetsPath, sidecarDir, latestPath) {
  const assets = readFileSync(assetsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const sidecars = {};
  if (existsSync(sidecarDir)) {
    for (const name of readdirSync(sidecarDir)) {
      if (name.endsWith('.sha256')) sidecars[name] = readFileSync(join(sidecarDir, name), 'utf8');
    }
  }
  let latest = null;
  if (existsSync(latestPath)) {
    try {
      latest = JSON.parse(readFileSync(latestPath, 'utf8'));
    } catch {
      latest = null;
    }
  }
  return { tag, assets, sidecars, latest };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [tag, assetsPath, sidecarDir, latestPath] = process.argv.slice(2);
  if (!tag || !assetsPath || !sidecarDir || !latestPath) {
    console.error('usage: check-release-assets.mjs vX.Y.Z <assets.jsonl> <sidecar-dir> <latest.json>');
    process.exit(2);
  }
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag)) {
    console.error(`not a release tag: ${tag}`);
    process.exit(2);
  }
  const inputs = readInputs(tag, assetsPath, sidecarDir, latestPath);
  for (const name of unexpectedAssets(inputs.assets)) {
    console.log(`::warning::${tag} carries ${name}, which release.yml does not build. Check whether an asset was renamed.`);
  }
  const problems = checkReleaseAssets(inputs);
  if (problems.length > 0) {
    for (const problem of problems) console.log(`::error::${problem}`);
    console.error(`${tag} is not ready to publish: ${problems.length} problem(s) above.`);
    process.exit(1);
  }
  console.log(
    `${tag}: all ${ARTIFACTS.length} files, their checksums and signatures, and latest.json are on the draft.`,
  );
}
