// @vitest-environment jsdom
//
// Regression coverage for the workspace hook.
//
// This file exists because B-27 found zero React hook or component tests
// against 87 modules — and A-13, B-16 and B-17 all lived in that gap. Each
// case below was reproduced by hand in the running GUI before being written
// down here.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspace } from './useWorkspace';
import type { WorkspaceModel } from './types';

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

// Selection logic clamps against the row count, so a tab with no result has
// zero rows and every selection call short-circuits. Tests that assert on a
// selected index must give the tab real rows or they pass vacuously.
const SCAN_PORTS = [22, 80, 443, 8080, 8443].map((port) => ({
  port,
  open: true,
  status: 'open',
  service: `svc-${port}`,
  latency_ms: 1,
  banner: '',
}));

/**
 * A scan tab of this test's own.
 *
 * These cases patch scan-shaped results in, so they need a scan tab -- not
 * whatever the app currently opens with. They used to lean on the default
 * being `scan`; when it became `discover` the rows were built and sorted as
 * discover rows and a scan-specific index stopped meaning anything.
 */
function withScanTab(result: { current: WorkspaceModel }) {
  act(() => {
    result.current.addTab('scan');
  });
  return result.current.activeTabId;
}

function scanResult() {
  return { kind: 'scan', data: SCAN_PORTS } as never;
}

// Backend order, deliberately not ascending: sorted by port these become
// 22, 80, 443, 8080, 8443, so every row's build index differs from where it
// is rendered.
const UNSORTED_SCAN_PORTS = [8443, 22, 443, 80, 8080].map((port) => ({
  port,
  open: true,
  status: 'open',
  service: `svc-${port}`,
  latency_ms: 1,
  banner: '',
}));

function unsortedScanResult() {
  return { kind: 'scan', data: UNSORTED_SCAN_PORTS } as never;
}

describe('tab selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // B-16: the reset effect keyed on `sortKey`/`sortDir`, and each tool kind
  // has a different DEFAULT_SORT, so merely switching tabs looked like a
  // re-sort and wiped the destination tab's selection.
  //
  // Reproduced live: scan -> ARP -> scan dropped a 3-row selection to 0,
  // while scan -> scan -> scan kept all 3.
  it('keeps a tab selection when switching away and back', async () => {
    const { result } = renderWorkspace();

    const firstTabId = withScanTab(result);
    act(() => {
      result.current.patchTab(firstTabId, { result: scanResult() });
    });
    act(() => {
      result.current.addTab('arp');
    });
    const secondTabId = result.current.activeTabId;
    expect(secondTabId).not.toBe(firstTabId);

    act(() => {
      result.current.patchTab(firstTabId, { selectedIndex: 2, selectedIndices: [2], selectionAnchor: 2 });
    });

    act(() => {
      result.current.setActiveTabId(firstTabId);
    });

    await waitFor(() => {
      const tab = result.current.tabs.find((item) => item.id === firstTabId);
      expect(tab?.selectedIndices).toEqual([2]);
    });
  });

  // Re-sorting the *same* tab must still reset, because the row at a given
  // index becomes a different row. This is the behaviour the B-16 fix had to
  // preserve while dropping the cross-tab reset.
  it('resets the selection when the active tab is re-sorted', async () => {
    const { result } = renderWorkspace();
    const tabId = result.current.activeTabId;

    act(() => {
      result.current.patchTab(tabId, { selectedIndex: 3, selectedIndices: [3], selectionAnchor: 3 });
    });
    act(() => {
      result.current.patchTab(tabId, { sortKey: 'port', sortDir: 'desc' });
    });

    await waitFor(() => {
      const tab = result.current.tabs.find((item) => item.id === tabId);
      expect(tab?.selectedIndices).toEqual([0]);
    });
  });

  // A-13: workspace search jumped to a row via `setActiveTabId` followed by
  // `setTimeout(() => selectRow(i), 0)`. The timeout kept the pre-switch
  // closure, so it patched the *previous* tab.
  //
  // Reproduced live: parked on ARP, searched `nginx` (row index 1), the jump
  // switched tabs correctly but selected index 0.
  it('selects a row in a named tab without touching the active one', async () => {
    const { result } = renderWorkspace();
    const firstTabId = result.current.activeTabId;

    // Give the target tab rows, otherwise the clamp short-circuits and this
    // assertion would hold no matter which tab got patched.
    act(() => {
      result.current.patchTab(firstTabId, { result: scanResult() });
    });
    act(() => {
      result.current.addTab('arp');
    });
    const secondTabId = result.current.activeTabId;
    expect(result.current.activeTabId).toBe(secondTabId);

    act(() => {
      result.current.selectRowInTab(firstTabId, 'scan-port-8080-3');
    });

    await waitFor(() => {
      const target = result.current.tabs.find((item) => item.id === firstTabId);
      const other = result.current.tabs.find((item) => item.id === secondTabId);
      // The *named* tab moved, even though a different tab is active. Under
      // the old stale-closure path this landed on the active tab instead.
      expect(target?.selectedIndex).toBe(3);
      expect(target?.selectedIndices).toEqual([3]);
      expect(other?.selectedIndex).toBe(0);
    });
  });

  // Was a clamp test, when this took an index. An id cannot be out of range,
  // so what it guarded -- a stale reference must not move the selection --
  // is now expressed as an id the tab does not hold.
  it('leaves the selection alone for a row id the tab does not hold', async () => {
    const { result } = renderWorkspace();
    const firstTabId = withScanTab(result);
    act(() => {
      result.current.patchTab(firstTabId, { result: scanResult(), selectedIndex: 2, selectedIndices: [2] });
    });
    act(() => {
      result.current.addTab('arp');
    });

    act(() => {
      result.current.selectRowInTab(firstTabId, 'scan-port-9999-0');
    });

    await waitFor(() => {
      const target = result.current.tabs.find((item) => item.id === firstTabId);
      expect(target?.selectedIndex).toBe(2);
    });
  });

  // The search dialog enumerates rows with `buildRows(tab.result)` -- backend
  // order -- while the table renders `filterAndSortRows(...)`. Passing an
  // index between the two selected whatever happened to sit at that position
  // in the other list.
  //
  // The existing fixture hid this: its ports are already ascending, so build
  // order and display order agree and any index works. These ports do not.
  it('jumps to the row that was searched for, not the one at that position', async () => {
    const { result } = renderWorkspace();
    const tabId = withScanTab(result);
    act(() => {
      result.current.patchTab(tabId, { result: unsortedScanResult() });
    });

    // Port 8443 arrives first from the backend but sorts last of five.
    act(() => {
      result.current.selectRowInTab(tabId, 'scan-port-8443-0');
    });

    await waitFor(() => {
      const target = result.current.tabs.find((item) => item.id === tabId);
      // Index 4, not the 0 an index-carrying caller would have produced.
      expect(target?.selectedIndex).toBe(4);
      expect(result.current.rows[target?.selectedIndex ?? -1]?.data.port).toBe(8443);
    });
  });

  it('ignores a jump to a tab that no longer exists', () => {
    const { result } = renderWorkspace();
    expect(() => {
      act(() => {
        result.current.selectRowInTab('no-such-tab', 'scan-port-22-0');
      });
    }).not.toThrow();
  });
});

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
