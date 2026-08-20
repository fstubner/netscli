import { buildRows, filterAndSortRows } from '../tools/presentation';
import type { ResultRow, RowSelectionMode, WorkspaceTab } from '../tools/types';
import type { DefaultInterfaceInfo } from '../types/netscli';
import { enrichInterfaceRows } from './interfaceRows';
import { clampIndex, indexOfRowId, normalizeSelection, rangeBetween } from './selection';

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
  setFilterText,
  tabs,
  trafficInterfaceName,
}: {
  activeTab: WorkspaceTab | undefined;
  defaultInterface: DefaultInterfaceInfo | null;
  filterText: string;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  setFilterText: (value: string) => void;
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
   * memo, so the position is resolved against the right list.
   *
   * Takes a row *id* rather than an index for the same class of reason. The
   * caller enumerates rows in backend order; this list is sorted and
   * filtered, so an index meant one row to the search dialog and a different
   * one to the table.
   */
  function selectRowInTab(tabId: string, rowId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const tabRows = enrichInterfaceRows(
      buildRows(tab.result ?? null),
      defaultInterface?.name,
      trafficInterfaceName,
    );
    let visible = filterAndSortRows(tabRows, tab, filterText);
    let nextIndex = indexOfRowId(visible, rowId);

    // The row exists but the active filter hides it. Clearing the filter is
    // the only outcome that honours the request: leaving it selects nothing
    // and says nothing, which reads as a dead control.
    if (nextIndex === -1 && filterText) {
      setFilterText('');
      visible = filterAndSortRows(tabRows, tab, '');
      nextIndex = indexOfRowId(visible, rowId);
    }
    if (nextIndex === -1) return;

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
