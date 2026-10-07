/* Build latest.json, the file the desktop app's updater reads.
 *
 *   node scripts/release/updater-manifest.mjs v0.3.4 <signature-dir> > latest.json
 *
 * <signature-dir> holds one updater signature per update file, named after
 * the release asset it signs: `netscli-gui-windows-x86_64.msi.sig` and so on.
 * The release jobs make those as the very last thing done to each file --
 * after Authenticode signing for the MSI, after the host-library fix for the
 * AppImage -- because either change to the bytes breaks the signature Tauri
 * makes when it first builds them.
 *
 * All or nothing. The updater parses and validates the whole file before it
 * compares versions, so one malformed entry breaks the check for every
 * platform, not just its own. A missing signature therefore fails the build
 * rather than producing a latest.json with a gap in it.
 *
 * Every signature must also be bound to this version: its trusted comment,
 * which minisign's global signature covers, must carry `version:X.Y.Z`. The
 * app sets `requireSignedVersion` (from 0.3.5), so it refuses an update
 * whose signature names no version or another one. That is what stops an
 * edited latest.json from pairing a new version number with an older,
 * validly signed installer. 0.3.4's MSI and AppImage signatures carried no
 * version, because those two are re-signed after the build and the re-sign
 * did not pass one. Catching that here fails the release on the draft
 * instead of shipping an update every 0.3.5 install would refuse.
 *
 * Platform keys are `{os}-{arch}-{installer}`, never the bare `{os}-{arch}`.
 * The plugin tries the installer-specific key first and falls back to the
 * bare one, so a bare `linux-x86_64` would be offered to a .deb install and
 * that install would be handed an AppImage. With only specific keys, a .deb
 * finds nothing to install. (The app also never calls the updater on a .deb;
 * this is the second line.)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { releaseSummary } from '../release-summary.mjs';

const REPO = 'https://github.com/fstubner/netscli';

/** Updater key -> release asset. The only table to change when a platform
 *  gains or loses an in-app update. */
export const UPDATE_ASSETS = {
  'windows-x86_64-msi': 'netscli-gui-windows-x86_64.msi',
  'linux-x86_64-appimage': 'netscli-gui-linux-x86_64.AppImage',
  'darwin-aarch64-app': 'netscli-gui-macos-aarch64.app.tar.gz',
  'darwin-x86_64-app': 'netscli-gui-macos-x86_64.app.tar.gz',
};

/* A Tauri signature file is base64 wrapping a minisign signature, whose
 * first line is always an "untrusted comment:". Checking for it catches an
 * empty file, a truncated upload, or the wrong file entirely -- all of which
 * would otherwise surface only as "signature verification failed" on a
 * user's machine. */
export function readSignature(path) {
  const raw = readFileSync(path, 'utf8').trim();
  let decoded = '';
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    // fall through to the check below
  }
  if (!raw || !decoded.startsWith('untrusted comment:')) {
    throw new Error(`${path} is not a Tauri updater signature`);
  }
  return raw;
}

/* The version a signature was made for, or null if it names none.
 *
 * The Tauri CLI writes the trusted comment as tab-separated fields,
 * `timestamp:...\tfile:...` and then `\tversion:X.Y.Z` when it is given a
 * version: always by `tauri build` and `tauri bundle`, and by `tauri signer
 * sign` only with `--app-version` (crates/tauri-cli/src/helpers/
 * updater_signature.rs at tauri-cli-v2.12.1). The plugin reads it the same
 * way (tauri-plugin-updater 2.13.1, `signed_version`). */
export function signedVersion(signature) {
  const decoded = Buffer.from(signature, 'base64').toString('utf8');
  const comment = decoded.split('\n').find((line) => line.startsWith('trusted comment:'));
  if (!comment) return null;
  const field = comment
    .slice('trusted comment:'.length)
    .trim()
    .split('\t')
    .find((part) => part.startsWith('version:'));
  return field ? field.slice('version:'.length).trim() : null;
}

/* The dialog renders notes as plain text, so the Markdown backticks the
 * site's summaries use for commands would show up literally. */
function notesFor(tag) {
  const summary = releaseSummary(tag);
  return summary
    ? summary.replaceAll('`', '')
    : `See the release notes: ${REPO}/releases/tag/${tag}`;
}

export function buildManifest(tag, signatureDir, now = new Date()) {
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag)) {
    throw new Error(`not a release tag: ${tag}`);
  }
  const version = tag.slice(1);
  const missing = [];
  const unbound = [];
  const platforms = {};
  for (const [key, asset] of Object.entries(UPDATE_ASSETS)) {
    const sigPath = join(signatureDir, `${asset}.sig`);
    if (!existsSync(sigPath)) {
      missing.push(`${asset}.sig`);
      continue;
    }
    const signature = readSignature(sigPath);
    // The plugin compares these as semver and ignores a leading `v`.
    const signed = signedVersion(signature);
    if (signed?.replace(/^v/, '') !== version) {
      unbound.push(`${asset}.sig (${signed ? `signed for ${signed}` : 'no version'})`);
    }
    platforms[key] = {
      signature,
      url: `${REPO}/releases/download/${tag}/${asset}`,
    };
  }
  if (missing.length > 0) {
    throw new Error(`missing updater signatures in ${signatureDir}: ${missing.join(', ')}`);
  }
  if (unbound.length > 0) {
    throw new Error(
      `updater signatures not bound to ${version}: ${unbound.join(', ')}. ` +
        `The app requires a signed version. Sign with \`tauri signer sign --app-version ${version}\`.`,
    );
  }
  return {
    version,
    notes: notesFor(tag),
    pub_date: now.toISOString(),
    platforms,
  };
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/').replace(/^(?=[A-Za-z]:)/, '/')}`) {
  const [tag, dir] = process.argv.slice(2);
  if (!tag || !dir) {
    console.error('usage: updater-manifest.mjs vX.Y.Z <signature-dir>');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(buildManifest(tag, dir), null, 2)}\n`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
