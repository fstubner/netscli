import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

/** Mirrors `InstallSupport` in src-tauri/src/updates.rs. */
export interface InstallSupport {
  supported: boolean;
  reason: string | null;
}

export type { Update };

const NOT_SUPPORTED: InstallSupport = {
  supported: false,
  reason: null,
};

/**
 * Whether this install may replace itself. Scoop, the AUR package and .deb
 * installs cannot, and keep the plain "view the release" notice instead.
 * See updates.rs for why each of them is excluded.
 *
 * A failure here is treated as "no": offering an install the app is not sure
 * it can perform is worse than offering a link.
 */
export async function getInstallSupport(): Promise<InstallSupport> {
  try {
    return await invoke<InstallSupport>('update_install_support');
  } catch (error) {
    console.error('Could not determine whether this install can update itself:', error);
    return NOT_SUPPORTED;
  }
}

// The plugin applies no timeout unless it is given one, and the update dialog
// cannot be closed while an install runs. A transfer that stalls would
// therefore leave a modal nobody can dismiss, so both calls get a deadline.
//
// These are limits on the whole request, not on silence between chunks, so the
// download one must allow a slow connection to finish. The largest installer
// is the Linux AppImage, 84 MB in 0.3.4. A deadline that passes ends in the
// dialog's own "failed" state, which offers the release page.
const CHECK_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Fetches latest.json from the newest release and returns the update if its
 * version is newer than this one. The plugin verifies nothing yet at this
 * point -- the signature is checked against the embedded public key only
 * when the update is downloaded.
 */
export function checkForUpdate(): Promise<Update | null> {
  return check({ timeout: CHECK_TIMEOUT_MS });
}

/**
 * Downloads, verifies and installs the update, then restarts.
 *
 * `onProgress` receives a fraction from 0 to 1, or null while the size is
 * unknown (a server that sends no Content-Length).
 *
 * On Windows the plugin exits the app itself to let the MSI run, and the MSI
 * relaunches it afterwards (AUTOLAUNCHAPP in wix/main.wxs), so the
 * `relaunch()` below is never reached there. On macOS and Linux the files
 * are replaced under the running process and the restart is ours to do.
 */
export async function installUpdate(
  update: Update,
  onProgress: (fraction: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let received = 0;

  await update.downloadAndInstall(
    (event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? null;
          onProgress(total ? 0 : null);
          break;
        case 'Progress':
          received += event.data.chunkLength;
          onProgress(total ? Math.min(received / total, 1) : null);
          break;
        case 'Finished':
          onProgress(1);
          break;
      }
    },
    { timeout: DOWNLOAD_TIMEOUT_MS },
  );

  await relaunch();
}
