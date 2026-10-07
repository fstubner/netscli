/* Tests for check-release-assets.mjs, the last check before a release goes
 * public.
 *
 * It only ever runs during a release, so a mistake in it would surface
 * then: either it blocks a good release, which is loud, or it passes an
 * incomplete one, which is the failure it exists to prevent and is silent.
 * These pin the second direction. Each case starts from a complete draft
 * and takes away one thing a real release has lost.
 *
 *   node --test scripts/release/check-release-assets.test.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { ARTIFACTS, SIDECARS, checkReleaseAssets, unexpectedAssets } from './check-release-assets.mjs';
import { UPDATE_ASSETS } from './updater-manifest.mjs';

const TAG = 'v0.3.5';

const digestOf = (text) => createHash('sha256').update(text).digest('hex');

/** A draft with every file, each sidecar agreeing with its file. */
function completeDraft() {
  const assets = [];
  const sidecars = {};
  for (const artifact of ARTIFACTS) {
    const digest = digestOf(artifact);
    assets.push({ name: artifact, size: 4096, digest: `sha256:${digest}` });
    for (const suffix of SIDECARS) {
      assets.push({ name: `${artifact}${suffix}`, size: 128, digest: `sha256:${digestOf(suffix)}` });
    }
    sidecars[`${artifact}.sha256`] = `${digest}  ${artifact}\n`;
  }
  assets.push({ name: 'latest.json', size: 2048, digest: `sha256:${digestOf('latest')}` });
  const platforms = {};
  for (const [key, asset] of Object.entries(UPDATE_ASSETS)) {
    platforms[key] = {
      signature: Buffer.from(`untrusted comment: test\nsig\ntrusted comment: version:0.3.5\nglobal\n`).toString('base64'),
      url: `https://github.com/fstubner/netscli/releases/download/${TAG}/${asset}`,
    };
  }
  const latest = { version: '0.3.5', notes: 'test', pub_date: '2026-10-07T00:00:00.000Z', platforms };
  return { tag: TAG, assets, sidecars, latest };
}

const without = (draft, name) => ({ ...draft, assets: draft.assets.filter((asset) => asset.name !== name) });

test('a complete draft passes', () => {
  assert.deepEqual(checkReleaseAssets(completeDraft()), []);
});

test('the release builds 18 files', () => {
  // A platform added to release.yml without being added here would never be
  // checked, and one dropped from release.yml would fail every release.
  assert.equal(ARTIFACTS.length, 18);
  assert.equal(new Set(ARTIFACTS).size, ARTIFACTS.length);
});

test('a missing Windows installer fails it', () => {
  const problems = checkReleaseAssets(without(completeDraft(), 'netscli-gui-windows-x86_64.msi'));
  assert.deepEqual(problems, ['netscli-gui-windows-x86_64.msi is missing']);
});

test('a missing signed Windows CLI fails it', () => {
  const problems = checkReleaseAssets(without(completeDraft(), 'netscli-windows-x86_64.exe'));
  assert.deepEqual(problems, ['netscli-windows-x86_64.exe is missing']);
});

test('a missing sidecar fails it', () => {
  const problems = checkReleaseAssets(without(completeDraft(), 'netscli-macos-aarch64.pem'));
  assert.deepEqual(problems, ['netscli-macos-aarch64.pem is missing']);
});

test('an empty file fails it', () => {
  const draft = completeDraft();
  draft.assets.find((asset) => asset.name === 'netscli-linux-x86_64-musl').size = 0;
  assert.deepEqual(checkReleaseAssets(draft), ['netscli-linux-x86_64-musl is empty']);
});

test('a checksum that disagrees with the uploaded file fails it', () => {
  // What a re-run leaves behind when it replaces a file and then fails to
  // replace that file's sidecar.
  const draft = completeDraft();
  draft.sidecars['netscli-gui-linux-x86_64.AppImage.sha256'] = `${digestOf('older build')}  x\n`;
  const problems = checkReleaseAssets(draft);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^netscli-gui-linux-x86_64\.AppImage\.sha256 says [0-9a-f]{64}, but the uploaded file is/);
});

test('a sidecar that holds no digest fails it', () => {
  const draft = completeDraft();
  draft.sidecars['netscli-linux-aarch64.sha256'] = '\n';
  assert.deepEqual(checkReleaseAssets(draft), ['netscli-linux-aarch64.sha256 holds no SHA-256 digest']);
});

test('a missing latest.json fails it', () => {
  const draft = { ...without(completeDraft(), 'latest.json'), latest: null };
  assert.deepEqual(checkReleaseAssets(draft), ['latest.json is missing']);
});

test('latest.json for another version fails it', () => {
  const draft = completeDraft();
  draft.latest.version = '0.3.4';
  assert.deepEqual(checkReleaseAssets(draft), ['latest.json announces 0.3.4, not 0.3.5']);
});

test('latest.json pointing at another tag fails it', () => {
  const draft = completeDraft();
  draft.latest.platforms['windows-x86_64-msi'].url =
    'https://github.com/fstubner/netscli/releases/download/v0.3.4/netscli-gui-windows-x86_64.msi';
  const problems = checkReleaseAssets(draft);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^latest\.json sends windows-x86_64-msi to .*v0\.3\.4/);
});

test('latest.json missing a platform fails it', () => {
  const draft = completeDraft();
  delete draft.latest.platforms['darwin-x86_64-app'];
  assert.deepEqual(checkReleaseAssets(draft), ['latest.json has no darwin-x86_64-app entry']);
});

test('extra assets are reported, not failed', () => {
  const draft = completeDraft();
  draft.assets.push({ name: 'NetsCLI_0.3.5_x64_en-US.msi', size: 10, digest: `sha256:${digestOf('x')}` });
  assert.deepEqual(checkReleaseAssets(draft), []);
  assert.deepEqual(unexpectedAssets(draft.assets), ['NetsCLI_0.3.5_x64_en-US.msi']);
});
