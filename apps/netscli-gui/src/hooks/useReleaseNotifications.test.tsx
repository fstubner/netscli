// @vitest-environment jsdom
//
// Needs a DOM because renderHook mounts a component tree; the default
// environment here is node, opted out per-file.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/releases', () => ({
  fetchLatestRelease: vi.fn(() => new Promise(() => {})), // never settles; we only count calls
  isNewerVersion: (candidate: string, current: string) => candidate > current,
}));

vi.mock('../services/updater', () => ({
  getInstallSupport: vi.fn(),
  checkForUpdate: vi.fn(),
}));

const { fetchLatestRelease } = await import('../services/releases');
const { checkForUpdate, getInstallSupport } = await import('../services/updater');
const { DISMISSED_RELEASE_KEY, useReleaseNotifications } = await import('./useReleaseNotifications');

const options = (overrides: Partial<Parameters<typeof useReleaseNotifications>[0]> = {}) => ({
  appVersion: '0.3.0',
  enabled: true,
  dismissToast: () => {},
  // A fresh function identity each call, as the real hook produces.
  showUpdateToast: (_version: string, _url: string, _dialog?: boolean) => {},
  toast: null,
  ...overrides,
});

const fakeUpdate = (version: string) => ({ version, body: 'notes' }) as never;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(fetchLatestRelease).mockReset();
  vi.mocked(fetchLatestRelease).mockImplementation(() => new Promise(() => {}));
  vi.mocked(checkForUpdate).mockReset();
  vi.mocked(getInstallSupport).mockReset();
  vi.mocked(getInstallSupport).mockResolvedValue({ supported: false, reason: 'test' });
});

/**
 * The release check must fire once, not once per render.
 *
 * `showUpdateToast` and `dismissToast` are plain functions from
 * `useWorkspaceToast`, so every render gives them new identities. While they
 * were effect dependencies, each render aborted the in-flight request and
 * started another — roughly one request to api.github.com per progress event
 * during a scan, against an unauthenticated limit of 60 an hour.
 *
 * A re-render is exactly what this asserts, because the bug is invisible
 * otherwise: the feature works, it just quietly exhausts the rate limit.
 */
describe('useReleaseNotifications: how often it checks', () => {
  it('checks once across many re-renders with new callback identities', async () => {
    const { rerender } = renderHook(() => useReleaseNotifications(options()));
    await waitFor(() => expect(fetchLatestRelease).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 12; i += 1) rerender();
    await act(async () => {});

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
    expect(getInstallSupport).toHaveBeenCalledTimes(1);
  });

  it('does not check at all when release notifications are disabled', async () => {
    renderHook(() => useReleaseNotifications(options({ enabled: false })));
    await act(async () => {});
    expect(getInstallSupport).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it('re-checks when the app version changes', async () => {
    let version = '0.3.0';
    const { rerender } = renderHook(() => useReleaseNotifications(options({ appVersion: version })));
    await waitFor(() => expect(fetchLatestRelease).toHaveBeenCalledTimes(1));

    version = '0.4.0';
    rerender();
    await waitFor(() => expect(fetchLatestRelease).toHaveBeenCalledTimes(2));
  });
});

describe('useReleaseNotifications: which kind of notice', () => {
  it('offers an in-place install where the install can update itself', async () => {
    vi.mocked(getInstallSupport).mockResolvedValue({ supported: true, reason: null });
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate('0.4.0'));
    const showUpdateToast = vi.fn();

    const { result } = renderHook(() => useReleaseNotifications(options({ showUpdateToast })));

    await waitFor(() =>
      expect(showUpdateToast).toHaveBeenCalledWith(
        '0.4.0',
        'https://github.com/fstubner/netscli/releases/tag/v0.4.0',
        true,
      ),
    );
    expect(result.current.pendingUpdate).not.toBeNull();
    // latest.json replaces the API call; it is not made in addition to it.
    expect(fetchLatestRelease).not.toHaveBeenCalled();
  });

  it('keeps the link-only notice where the install cannot update itself', async () => {
    vi.mocked(fetchLatestRelease).mockResolvedValue({ version: '0.4.0', url: 'https://github.com/fstubner/netscli/releases/tag/v0.4.0' });
    const showUpdateToast = vi.fn();

    const { result } = renderHook(() => useReleaseNotifications(options({ showUpdateToast })));

    await waitFor(() => expect(showUpdateToast).toHaveBeenCalledTimes(1));
    expect(showUpdateToast.mock.calls[0]).toHaveLength(2); // no dialog flag
    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(result.current.pendingUpdate).toBeNull();
  });

  it('falls back to the link when latest.json cannot be fetched', async () => {
    // The window between a release going public and latest.json being
    // attached, or a release that shipped without one.
    vi.mocked(getInstallSupport).mockResolvedValue({ supported: true, reason: null });
    vi.mocked(checkForUpdate).mockRejectedValue(new Error('404'));
    vi.mocked(fetchLatestRelease).mockResolvedValue({ version: '0.4.0', url: 'https://github.com/fstubner/netscli/releases/tag/v0.4.0' });
    const showUpdateToast = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useReleaseNotifications(options({ showUpdateToast })));

    await waitFor(() => expect(showUpdateToast).toHaveBeenCalledTimes(1));
    expect(showUpdateToast.mock.calls[0][0]).toBe('0.4.0');
  });

  it('stays quiet about a version the user skipped', async () => {
    window.localStorage.setItem(DISMISSED_RELEASE_KEY, '0.4.0');
    vi.mocked(getInstallSupport).mockResolvedValue({ supported: true, reason: null });
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate('0.4.0'));
    const showUpdateToast = vi.fn();

    renderHook(() => useReleaseNotifications(options({ showUpdateToast })));

    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    await act(async () => {});
    expect(showUpdateToast).not.toHaveBeenCalled();
  });

  it('records a skipped version and clears the pending update', async () => {
    vi.mocked(getInstallSupport).mockResolvedValue({ supported: true, reason: null });
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate('0.4.0'));
    const dismissToast = vi.fn();

    const { result } = renderHook(() => useReleaseNotifications(options({ dismissToast })));
    await waitFor(() => expect(result.current.pendingUpdate).not.toBeNull());

    act(() => result.current.openDialog());
    act(() => result.current.skipVersion('0.4.0'));

    expect(window.localStorage.getItem(DISMISSED_RELEASE_KEY)).toBe('0.4.0');
    expect(result.current.pendingUpdate).toBeNull();
    expect(result.current.dialogOpen).toBe(false);
    expect(dismissToast).toHaveBeenCalled();
  });
});
