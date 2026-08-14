import { buildRows, filterAndSortRows } from '../tools/presentation';
import type { ResultRow, RowSelectionMode, WorkspaceTab } from '../tools/types';
import type { DefaultInterfaceInfo } from '../types/netscli';
import { enrichInterfaceRows } from './interfaceRows';
import { clampIndex, normalizeSelection, rangeBetween } from './selection';

/**
 * Row-selection commands for the workspace.
 *
 * Split out of `useWorkspace` because that hook had grown past the
 * maintainability cap; the size gate's own note named selection handling as
 * the next thing to extract. It is a natural seam — everything here is a
 * command that reads a tab and writes a selection patch.
 */
export function useSelection({
  activeTab,
  defaultInterface,
  filterText,
  patchTab,
  rows,
  tabs,
  trafficInterfaceName,
}: {
  activeTab: WorkspaceTab | undefined;
  defaultInterface: DefaultInterfaceInfo | null;
  filterText: string;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  rows: ResultRow[];
  tabs: WorkspaceTab[];
  trafficInterfaceName: string | null;
}) {
  function selectRow(index: number, mode: RowSelectionMode = 'single') {
    if (!activeTab) return;
    const rowCount = rows.length;
    if (rowCount === 0) return;

    const nextIndex = clampIndex(index, rowCount);
    const currentSelection = normalizeSelection(
      activeTab.selectedIndices,
      activeTab.selectedIndex,
      rowCount,
    );
    const anchor = clampIndex(activeTab.selectionAnchor ?? activeTab.selectedIndex, rowCount);

    if (mode === 'range') {
      patchTab(activeTab.id, {
        selectedIndex: nextIndex,
        selectedIndices: rangeBetween(anchor, nextIndex),
        selectionAnchor: anchor,
      });
      return;
    }

    if (mode === 'toggle') {
      const selected = new Set(currentSelection);
      if (selected.has(nextIndex) && selected.size > 1) {
        selected.delete(nextIndex);
      } else {
        selected.add(nextIndex);
      }
      patchTab(activeTab.id, {
        selectedIndex: nextIndex,
        selectedIndices: Array.from(selected).sort((left, right) => left - right),
        selectionAnchor: nextIndex,
      });
      return;
    }

    if (mode === 'focus') {
      patchTab(activeTab.id, { selectedIndex: nextIndex });
      return;
    }

    patchTab(activeTab.id, {
      selectedIndex: nextIndex,
      selectedIndices: [nextIndex],
      selectionAnchor: nextIndex,
    });
  }

  /**
   * Select a row in an explicitly named tab, which may not be the active one.
   *
   * The workspace-search "jump to result" path used to call `setActiveTabId`
   * and then `setTimeout(() => selectRow(i), 0)`. The timeout fired after
   * commit but still held the *pre-switch* closure, so it patched the
   * previous tab and clamped against the previous tab's row count (A-13).
   *
   * Addressing the tab by id removes the ordering dependency: rows for the
   * destination tab are derived here rather than read from the active-tab
   * memo, so the index is clamped against the right list.
   */
  function selectRowInTab(tabId: string, index: number) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const tabRows = filterAndSortRows(
      enrichInterfaceRows(buildRows(tab.result ?? null), defaultInterface?.name, trafficInterfaceName),
      tab,
      filterText,
    );
    if (tabRows.length === 0) return;
    const nextIndex = clampIndex(index, tabRows.length);
    patchTab(tabId, {
      selectedIndex: nextIndex,
      selectedIndices: [nextIndex],
      selectionAnchor: nextIndex,
    });
  }

  function selectAllRows() {
    if (!activeTab || rows.length === 0) return;
    patchTab(activeTab.id, {
      selectedIndex: 0,
      selectedIndices: rows.map((_row, index) => index),
      selectionAnchor: 0,
      detailTab: rows.length > 1 ? 'selection' : activeTab.detailTab,
    });
  }

  return { selectRow, selectRowInTab, selectAllRows };
}
