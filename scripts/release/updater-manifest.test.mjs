/* Tests for updater-manifest.mjs, which writes latest.json.
 *
 * The app sets `requireSignedVersion`, so every signature in latest.json has
 * to carry the version it was made for. A release whose signatures do not
 * is one every installed copy refuses to update to, and nothing but these
 * checks would say so before users did.
 *
 *   node --test scripts/release/updater-manifest.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { UPDATE_ASSETS, buildManifest, signedVersion } from './updater-manifest.mjs';

/** A Tauri signature file: base64 around a minisign signature. Only the two
 *  comment lines matter to the code under test. */
const signature = (trustedComment) =>
  Buffer.from(
    `untrusted comment: signature from tauri secret key\nRUQfake\ntrusted comment: ${trustedComment}\nfakeglobal\n`,
  ).toString('base64');

/** A directory with one signature per update file, `comment(asset)` each. */
function signatureDir(comment) {
  const dir = mkdtempSync(join(tmpdir(), 'updater-sigs-'));
  for (const asset of Object.values(UPDATE_ASSETS)) {
    writeFileSync(join(dir, `${asset}.sig`), signature(comment(asset)));
  }
  return dir;
}

test('reads the version from a signature that has one', () => {
  assert.equal(signedVersion(signature('timestamp:1\tfile:app.msi\tversion:0.3.5')), '0.3.5');
});

test('reads no version from a signature made without one', () => {
  assert.equal(signedVersion(signature('timestamp:1791080847\tfile:netscli-gui-windows-x86_64.msi')), null);
});

test('builds latest.json when every signature is bound to the version', () => {
  const dir = signatureDir((asset) => `timestamp:1\tfile:${asset}\tversion:0.3.5`);
  try {
    const manifest = buildManifest('v0.3.5', dir);
    assert.equal(manifest.version, '0.3.5');
    assert.deepEqual(Object.keys(manifest.platforms).sort(), Object.keys(UPDATE_ASSETS).sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a signature bound to no version', () => {
  // How 0.3.4's MSI and AppImage were signed: re-signed after the build,
  // without --app-version.
  const dir = signatureDir((asset) =>
    asset.endsWith('.msi') ? `timestamp:1\tfile:${asset}` : `timestamp:1\tfile:${asset}\tversion:0.3.5`,
  );
  try {
    assert.throws(() => buildManifest('v0.3.5', dir), /not bound to 0\.3\.5: netscli-gui-windows-x86_64\.msi\.sig \(no version\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a signature bound to another version', () => {
  const dir = signatureDir((asset) => `timestamp:1\tfile:${asset}\tversion:0.3.4`);
  try {
    assert.throws(() => buildManifest('v0.3.5', dir), /signed for 0\.3\.4/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
