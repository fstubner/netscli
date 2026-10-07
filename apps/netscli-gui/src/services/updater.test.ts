import { beforeEach, describe, expect, it, vi } from 'vitest';

const check = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({ check: (...args: unknown[]) => check(...args) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { checkForUpdate, installUpdate } = await import('./updater');

/**
 * The plugin waits forever unless it is given a timeout, and the update dialog
 * cannot be closed while an install runs. So a download that stalls is a modal
 * the user can only leave by quitting the app. Nothing else in the suite
 * notices if the timeouts are dropped: the dialog tests replace the install
 * with a stub, and the plugin itself is never run.
 */
describe('update timeouts', () => {
  beforeEach(() => {
    check.mockReset();
  });

  it('gives the update check a deadline', async () => {
    check.mockResolvedValue(null);
    await checkForUpdate();
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0]?.timeout, 'the check was given no timeout').toBeGreaterThan(0);
  });

  it('gives the download a deadline', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    await installUpdate({ downloadAndInstall } as never, () => {});
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(
      downloadAndInstall.mock.calls[0][1]?.timeout,
      'the download was given no timeout',
    ).toBeGreaterThan(0);
  });
});
