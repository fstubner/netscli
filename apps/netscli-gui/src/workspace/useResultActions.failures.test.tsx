// @vitest-environment jsdom
//
// B1: at stock settings, a failed action said nothing at all.
//
// Interaction toasts default to off, and every failure outside a run was
// reported as one, so the toast was dropped and nothing replaced it. A failed
// export wrote no file and showed no message -- on screen, indistinguishable
// from a success. PRODUCT.md names that exact shape as the thing this product
// most has to avoid, and `usePreferences.ts` carried a comment claiming it
// could not happen.
//
// These assert the channel rather than the wording: a failure has to reach the
// tab's error strip while the toast preferences sit at their defaults.

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useResultActions } from './useResultActions';
import type { WorkspaceTab } from '../tools/types';

vi.mock('../services/netscli', () => ({
  openFilesystemPath: vi.fn(() => Promise.reject(new Error('no such path'))),
  revealFilesystemPath: vi.fn(() => Promise.reject(new Error('no such path'))),
}));

function setup(commandPreview = 'netscli discover 192.168.1.0/24') {
  const tab = { id: 'tab-1', kind: 'discover', error: null } as unknown as WorkspaceTab;
  let tabs: WorkspaceTab[] = [tab];
  const showToast = vi.fn();
  const setTabs = vi.fn((update) => {
    tabs = typeof update === 'function' ? update(tabs) : update;
  });

  const hook = renderHook(() =>
    useResultActions({
      activeTab: tab,
      columns: [],
      rows: [],
      selectedRow: undefined,
      selectedRows: [],
      commandPreview,
      setTabs,
      setActiveTabId: vi.fn(),
      showToast,
    } as never),
  );
  return { hook, showToast, errorOf: () => tabs[0]?.error };
}

describe('a failed action is visible at default settings', () => {
  it('puts a failed copy on the tab error strip', async () => {
    // jsdom has no clipboard, which is the "clipboard unavailable" branch.
    expect(navigator.clipboard).toBeUndefined();
    const { hook, showToast, errorOf } = setup();

    await act(async () => {
      await hook.result.current.copyCommand();
    });

    expect(errorOf()).toMatch(/clipboard unavailable/i);
    // Not a toast: that channel is preference-gated and off by default, which
    // is precisely how this failure used to disappear.
    expect(showToast).not.toHaveBeenCalled();
  });

  it('puts a failed capture open on the tab error strip', async () => {
    const { hook, showToast, errorOf } = setup();

    await act(async () => {
      await hook.result.current.openCaptureFile('C:/nope/capture.pcap');
    });

    expect(errorOf()).toMatch(/Open failed/i);
    expect(showToast).not.toHaveBeenCalled();
  });
});
