// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceToast } from './useWorkspaceToast';

const options = {
  interactionToasts: false,
  maxConcurrentProbes: 64,
  operationToasts: false,
  persistentHistory: true,
};
const RELEASE = 'https://github.com/fstubner/netscli/releases/tag/v0.4.0';

describe('update toast', () => {
  it('names the version', () => {
    const { result } = renderHook(() => useWorkspaceToast(options));
    act(() => result.current.showUpdateToast('0.4.0', RELEASE));
    expect(result.current.toast?.message).toBe('Update available: v0.4.0');
  });

  it('carries the reason an install cannot update itself, so the user sees it', () => {
    const { result } = renderHook(() => useWorkspaceToast(options));
    act(() =>
      result.current.showUpdateToast('0.4.0', RELEASE, false, 'Installed with Scoop, so update it there'),
    );
    expect(result.current.toast?.message).toBe(
      'Update available: v0.4.0. Installed with Scoop, so update it there',
    );
  });
});

// A confirmation can go after a moment. An error is the one message that says
// something failed, and it used to leave after 1.8 seconds like the rest.
describe('toast lifetime', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps an error until it is dismissed and lets a confirmation go', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceToast({ ...options, interactionToasts: true }));

    act(() => result.current.showToast({ message: 'Exported', kind: 'interaction' }));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.toast).toBeNull();

    act(() => result.current.showToast({ message: 'Export failed', kind: 'error' }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toast?.message).toBe('Export failed');

    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeNull();
  });
});
