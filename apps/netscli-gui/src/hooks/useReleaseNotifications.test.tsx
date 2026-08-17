// @vitest-environment jsdom
//
// Needs a DOM because renderHook mounts a component tree; the default
// environment here is node, opted out per-file.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReleaseNotifications } from './useReleaseNotifications';

vi.mock('../services/releases', () => ({
  fetchLatestRelease: vi.fn(() => new Promise(() => {})), // never settles; we only count calls
  isNewerVersion: () => false,
}));

const { fetchLatestRelease } = await import('../services/releases');

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
describe('useReleaseNotifications', () => {
  beforeEach(() => {
    vi.mocked(fetchLatestRelease).mockClear();
  });

  const options = (overrides: Partial<Parameters<typeof useReleaseNotifications>[0]> = {}) => ({
    appVersion: '0.3.0',
    enabled: true,
    dismissToast: () => {},
    // A fresh function identity each call, as the real hook produces.
    showUpdateToast: (_version: string, _url: string) => {},
    toast: null,
    ...overrides,
  });

  it('checks once across many re-renders with new callback identities', () => {
    const { rerender } = renderHook(() => useReleaseNotifications(options()));
    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 12; i += 1) rerender();

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
  });

  it('does not check at all when release notifications are disabled', () => {
    renderHook(() => useReleaseNotifications(options({ enabled: false })));
    expect(fetchLatestRelease).not.toHaveBeenCalled();
  });

  it('re-checks when the app version changes', () => {
    let version = '0.3.0';
    const { rerender } = renderHook(() => useReleaseNotifications(options({ appVersion: version })));
    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);

    version = '0.4.0';
    rerender();
    expect(fetchLatestRelease).toHaveBeenCalledTimes(2);
  });
});
