// @vitest-environment jsdom
//
// Tab lifecycle: opening, auto-running, and closing tabs.
//
// Split out of useWorkspace.test.tsx when that file crossed the 300-line
// guard. The selection cases stayed behind; they need scan-shaped result
// fixtures that nothing here does, so the two halves share no helpers beyond
// the mocks below.
//
// Those mocks are duplicated rather than imported, and that is not an
// oversight: `vi.mock` is hoisted to the top of the file it appears in, so a
// shared module exporting them would be evaluated too late to intercept
// anything. Keep the two copies in step.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWorkspace } from './useWorkspace';

// The hook reaches for Tauri and for persisted history on mount; neither
// exists under jsdom. Stub them so the tests exercise state logic only.
vi.mock('../services/env', () => ({ isTauri: () => false }));
vi.mock('../services/netscli', () => ({
  listenOperationProgress: vi.fn(() => Promise.resolve(() => undefined)),
  cancelOperation: vi.fn(() => Promise.resolve()),
  runOperation: vi.fn(() => Promise.resolve(null)),
  openFilesystemPath: vi.fn(() => Promise.resolve()),
}));
vi.mock('./historyStorage', () => ({
  loadHistory: () => [],
  saveHistory: () => undefined,
}));
vi.mock('./useNetworkStatus', () => ({
  useNetworkStatus: () => ({
    defaultInterface: undefined,
    interfaces: [],
    networkStats: null,
    setTrafficInterfaceName: () => undefined,
    statusInterfaceInfo: null,
    trafficInterface: undefined,
    trafficInterfaceName: undefined,
  }),
}));

const options = { persistentHistory: false, maxConcurrentProbes: 64 };

function renderWorkspace() {
  return renderHook(() => useWorkspace(options as never));
}

describe('tab lifecycle', () => {
  // B-17: `setActiveTabId` was called from inside a `setTabs` updater. React
  // requires updaters to be pure; StrictMode double-invokes them in dev.
  // Under StrictMode a non-idempotent updater would land on the wrong tab.
  it('picks the correct replacement tab when the active tab is closed', async () => {
    const { result } = renderWorkspace();
    const first = result.current.activeTabId;

    act(() => {
      result.current.addTab('arp');
    });
    const second = result.current.activeTabId;
    act(() => {
      result.current.addTab('dns');
    });
    const third = result.current.activeTabId;

    act(() => {
      result.current.closeTab(third);
    });

    await waitFor(() => {
      expect(result.current.tabs.map((tab) => tab.id)).toEqual([first, second]);
      // Closing the last tab falls back to its left-hand neighbour.
      expect(result.current.activeTabId).toBe(second);
    });
  });

  // Opening a scan/inspect from a result row's context menu carries the host
  // with it, so the new tab is already complete and runs itself. Without the
  // flag the tab opened pre-filled and sat there, waiting for a Run press
  // that could not add anything the click had not already said.
  it('runs a host tool opened from a result without a second press', async () => {
    const { result } = renderWorkspace();

    act(() => {
      result.current.openHostTool('scan', '192.168.1.5');
    });

    const opened = result.current.activeTabId;
    // Indexed rather than `.at(-1)`: the project's TS lib target predates
    // Array.prototype.at, and tsc rejects it even though vitest runs it fine.
    const newest = result.current.tabs[result.current.tabs.length - 1];
    expect(newest?.form.host).toBe('192.168.1.5');
    expect(result.current.needsAutoRun(opened)).toBe(true);
  });

  // The opposite case, and the reason this is not `shouldAutoRun(kind)`: a
  // scan tab opened from the toolbar has no host yet, so running it on sight
  // would scan the placeholder rather than anything the user asked about.
  it('does not run a blank scan tab opened from the toolbar', async () => {
    const { result } = renderWorkspace();

    act(() => {
      result.current.addTab('scan');
    });

    expect(result.current.needsAutoRun(result.current.activeTabId)).toBe(false);
  });

  it('closing a background tab leaves the active tab active', async () => {
    const { result } = renderWorkspace();
    const first = result.current.activeTabId;
    act(() => {
      result.current.addTab('arp');
    });
    const second = result.current.activeTabId;

    act(() => {
      result.current.closeTab(first);
    });

    await waitFor(() => {
      expect(result.current.activeTabId).toBe(second);
      expect(result.current.tabs).toHaveLength(1);
    });
  });
});
