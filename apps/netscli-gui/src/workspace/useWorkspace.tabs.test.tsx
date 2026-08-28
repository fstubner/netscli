// @vitest-environment jsdom
//
// Closing sets of tabs: the operations behind the tab context menu.
//
// Split from useWorkspace.test.tsx, which reached the 300-line guard. The
// mock preamble is repeated rather than shared: `vi.mock` is hoisted per
// file, so a shared harness module would have to re-declare it anyway.

import { act, renderHook } from '@testing-library/react';
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

// The tab context menu acts on the tab that was right-clicked, which is very
// often not the active one. `closeOtherTabs` previously only ever kept the
// active tab, so wiring a menu to it would have closed the tab the user was
// pointing at whenever they right-clicked a background one.
describe('closing a set of tabs', () => {
  function fourTabs() {
    const { result } = renderWorkspace();
    act(() => {
      result.current.closeAllTabs();
    });
    for (const kind of ['scan', 'ping', 'dns', 'trace'] as const) {
      act(() => {
        result.current.addTab(kind);
      });
    }
    return result;
  }

  it('keeps the tab it was given, not the active one', () => {
    const result = fourTabs();
    const [first, second] = result.current.tabs;
    act(() => {
      result.current.setActiveTabId(result.current.tabs[3].id);
    });

    act(() => {
      result.current.closeOtherTabs(second.id);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([second.id]);
    expect(result.current.activeTabId).toBe(second.id);
    expect(result.current.tabs.map((tab) => tab.id)).not.toContain(first.id);
  });

  it('closes only what is to the right, and keeps the anchor', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.closeTabsBeside(ids[1], 'right');
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([ids[0], ids[1]]);
  });

  it('closes only what is to the left, and keeps the anchor', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.closeTabsBeside(ids[2], 'left');
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([ids[2], ids[3]]);
  });

  it('moves the selection to the anchor when the active tab was closed', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);
    act(() => {
      result.current.setActiveTabId(ids[3]);
    });

    act(() => {
      result.current.closeTabsBeside(ids[1], 'right');
    });

    expect(result.current.activeTabId).toBe(ids[1]);
  });

  it('leaves the active tab alone when it survived', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);
    act(() => {
      result.current.setActiveTabId(ids[0]);
    });

    act(() => {
      result.current.closeTabsBeside(ids[1], 'right');
    });

    expect(result.current.activeTabId).toBe(ids[0]);
  });

  it('does nothing when there is nothing on that side', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.closeTabsBeside(ids[0], 'left');
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(ids);
  });
});

// Reordering is array order -- nothing else records where a tab sits -- and
// the thing worth pinning is that it does not disturb which tab is active.
// A strip that changed selection as you dragged would fight the drag.
describe('reordering tabs', () => {
  function fourTabs() {
    const { result } = renderWorkspace();
    act(() => {
      result.current.closeAllTabs();
    });
    for (const kind of ['scan', 'ping', 'dns', 'trace'] as const) {
      act(() => {
        result.current.addTab(kind);
      });
    }
    return result;
  }

  it('moves a tab to the requested slot', () => {
    const result = fourTabs();
    const [a, b, c, d] = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.moveTab(a, 2);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([b, c, a, d]);
  });

  it('moves a tab backwards too', () => {
    const result = fourTabs();
    const [a, b, c, d] = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.moveTab(d, 0);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([d, a, b, c]);
  });

  it('leaves the active tab active, whichever one moved', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);
    act(() => {
      result.current.setActiveTabId(ids[1]);
    });

    act(() => {
      result.current.moveTab(ids[3], 0);
    });

    expect(result.current.activeTabId).toBe(ids[1]);
  });

  it('clamps an index past the end instead of losing the tab', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.moveTab(ids[0], 99);
    });

    expect(result.current.tabs).toHaveLength(4);
    expect(result.current.tabs[result.current.tabs.length - 1].id).toBe(ids[0]);
  });

  it('does nothing for an unknown tab or a move to its own slot', () => {
    const result = fourTabs();
    const ids = result.current.tabs.map((tab) => tab.id);

    act(() => {
      result.current.moveTab('no-such-tab', 0);
      result.current.moveTab(ids[2], 2);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(ids);
  });
});
