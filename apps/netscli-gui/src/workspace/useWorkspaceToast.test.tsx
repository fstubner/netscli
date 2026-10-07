// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
