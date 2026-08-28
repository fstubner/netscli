import { useEffect, useMemo, useRef, useState } from 'react';

import { createTab, defaultDetailTab } from '../tools/registry';
import { buildCommand, buildRows, columnsFor, filterAndSortRows } from '../tools/presentation';
import type { HistoryEntry, ResultColumn, WorkspaceTab } from '../tools/types';
import { applyContextDefaults } from './networkDefaults';
import { createDemoScreenshotTabs, isDemoScreenshotMode } from './demoMode';
import { cancelWorkspaceTab, runWorkspaceTab } from './operations';
import { clampIndex, normalizeSelection } from './selection';
import { loadHistory, saveHistory } from './historyStorage';
import { enrichInterfaceRows } from './interfaceRows';
import { useResultActions } from './useResultActions';
import { useOperationProgress } from './useOperationProgress';
import { useSelection } from './useSelection';
import { useTabLifecycle } from './useTabLifecycle';
import type { WorkspaceModel, WorkspaceOptions } from './types';
import { useNetworkStatus } from './useNetworkStatus';
import { useWorkspaceToast } from './useWorkspaceToast';

export function useWorkspace(options: WorkspaceOptions): WorkspaceModel {
  const demoScreenshotMode = isDemoScreenshotMode();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    // Discover, not scan: the first useful question on an unfamiliar
    // network is "what is on it", and scan needs a host you do not have
    // yet. Scan remains one click away in the tab strip.
    demoScreenshotMode ? createDemoScreenshotTabs() : [createTab('discover')],
  );
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const [filterText, setFilterText] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>(() => (options.persistentHistory ? loadHistory() : []));
  const { dismissToast, showToast, showUpdateToast, toast } = useWorkspaceToast(options);
  const {
    defaultInterface,
    interfaces,
    networkStats,
    setTrafficInterfaceName,
    statusInterfaceInfo,
    trafficInterface,
    trafficInterfaceName,
  } = useNetworkStatus(showToast);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const baseRows = useMemo(
    () => enrichInterfaceRows(buildRows(activeTab?.result ?? null), defaultInterface?.name, trafficInterfaceName),
    [activeTab?.result, defaultInterface?.name, trafficInterfaceName],
  );
  const rows = useMemo(
    () => (activeTab ? filterAndSortRows(baseRows, activeTab, filterText) : []),
    [activeTab, baseRows, filterText],
  );
  const selectedIndex = clampIndex(activeTab?.selectedIndex ?? 0, rows.length);
  const selectedIndices = normalizeSelection(activeTab?.selectedIndices, activeTab?.selectedIndex, rows.length);
  const selectedRow = rows[selectedIndex];
  const selectedRows = selectedIndices.map((index) => rows[index]).filter(Boolean);
  const columns = columnsFor(activeTab?.kind ?? 'scan', activeTab?.result ?? null, baseRows);
  const commandPreview = activeTab ? buildCommand(activeTab) : '';

  const {
    activeOps,
    addTab,
    openHostTool,
    closeTab,
    closeAllTabs,
    closeOtherTabs: closeOtherTabsFor,
    closeTabsBeside,
    isTabActive,
    needsAutoRun,
    clearAutoRun,
  } = useTabLifecycle({
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    setFilterText,
    defaultInterface,
    trafficInterfaceName,
    interfaces,
  });

  const { selectRow, selectRowInTab, selectAllRows } = useSelection({
    activeTab,
    defaultInterface,
    filterText,
    patchTab,
    rows,
    setFilterText,
    tabs,
    trafficInterfaceName,
  });

  const resultActions = useResultActions({
    activeTab,
    columns,
    rows,
    selectedRow,
    selectedRows,
    commandPreview,
    setTabs,
    setActiveTabId,
    showToast,
  });

  useEffect(() => {
    if (options.persistentHistory) {
      saveHistory(history);
    } else {
      if (history.length > 0) setHistory([]);
      saveHistory([]);
    }
  }, [history, options.persistentHistory]);

  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const updated = applyContextDefaults(tab, defaultInterface, trafficInterfaceName, interfaces);
        if (updated !== tab) changed = true;
        return updated;
      });
      return changed ? next : prev;
    });
  }, [defaultInterface, interfaces, trafficInterfaceName]);

  // Reset the selection when the *same* tab is re-sorted or re-filtered,
  // because the row at a given index is then a different row.
  //
  // Keying this on `sortKey`/`sortDir` alone was wrong: each tool kind has
  // its own DEFAULT_SORT, so merely switching tabs changed those values and
  // wiped the destination tab's selection (B-16). Comparing against the
  // previous tab id distinguishes "this tab re-sorted" from "a different
  // tab became active".
  const lastSortRef = useRef<{ tabId: string; sortKey?: string; sortDir?: string; filterText: string } | null>(null);
  useEffect(() => {
    if (!activeTab) return;
    const prev = lastSortRef.current;
    const next = {
      tabId: activeTab.id,
      sortKey: activeTab.sortKey,
      sortDir: activeTab.sortDir,
      filterText,
    };
    lastSortRef.current = next;

    // First render, or the active tab changed: adopt the new state without
    // touching the selection the destination tab already had.
    if (!prev || prev.tabId !== next.tabId) return;
    if (prev.sortKey === next.sortKey && prev.sortDir === next.sortDir && prev.filterText === next.filterText) {
      return;
    }

    patchTab(activeTab.id, {
      selectedIndex: 0,
      selectedIndices: [0],
      selectionAnchor: 0,
    });
    // Deliberately not the whole `activeTab`: depending on the object would
    // refire whenever a result arrives and reset the selection under a run
    // in progress, which is what the sort/filter comparison above exists to
    // avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, activeTab?.sortDir, activeTab?.sortKey, filterText]);

  useOperationProgress({ activeOps, setTabs, showToast });

  function patchTab(id: string, patch: Partial<WorkspaceTab>) {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }

  function patchForm(id: string, key: string, value: string) {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== id || tab.busy) return tab;
        return {
          ...tab,
          detailTab: defaultDetailTab(tab.kind),
          error: null,
          form: { ...tab.form, [key]: value },
          result: null,
          selectedIndex: 0,
          selectedIndices: [0],
          selectionAnchor: 0,
        };
      }),
    );
  }

  // The menu bar acts on the active tab; the tab context menu passes the id
  // of the tab that was right-clicked, which is often not the active one.
  function closeOtherTabs(tabId?: string) {
    closeOtherTabsFor(tabId ? tabs.find((tab) => tab.id === tabId) : activeTab);
  }

  async function runTab(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (toast?.kind === 'operation') {
      dismissToast();
    }
    await runWorkspaceTab({
      activeOps,
      isTabActive,
      maxConcurrentProbes: options.maxConcurrentProbes,
      patchTab,
      persistentHistory: options.persistentHistory,
      setHistory,
      showToast,
      tab,
    });
  }

  async function cancelTab(tabId: string) {
    await cancelWorkspaceTab(tabId, activeOps, patchTab);
  }

  function sortBy(column: ResultColumn) {
    if (!activeTab) return;
    const nextDir = activeTab.sortKey === column.key && activeTab.sortDir === 'asc' ? 'desc' : 'asc';
    patchTab(activeTab.id, { sortKey: column.key, sortDir: nextDir });
  }

  function openHistoryEntry(entry: HistoryEntry) {
    const tab = createTab(entry.result.kind);
    tab.title = entry.tabTitle;
    tab.form = { ...entry.form };
    tab.result = entry.result;
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function clearHistory() {
    setHistory([]);
  }

  function clearCurrentResults() {
    if (!activeTab) return;
    patchTab(activeTab.id, {
      result: null,
      error: null,
      selectedIndex: 0,
      selectedIndices: [0],
      selectionAnchor: 0,
    });
  }

  return {
    tabs,
    activeTab,
    activeTabId,
    filterText,
    toast,
    history,
    networkStats,
    defaultInterface,
    statusInterfaceInfo,
    trafficInterface,
    trafficInterfaceName,
    interfaces,
    rows,
    selectedRow,
    selectedRows,
    columns,
    commandPreview,
    setActiveTabId,
    setFilterText,
    setTrafficInterfaceName,
    dismissToast,
    showUpdateToast,
    patchTab,
    patchForm,
    selectRow,
    selectRowInTab,
    selectAllRows,
    addTab,
    openHostTool,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsBeside,
    needsAutoRun,
    clearAutoRun,
    runTab,
    cancelTab,
    sortBy,
    openHistoryEntry,
    clearHistory,
    clearCurrentResults,
    showInteractionToast: (message: string) => showToast({ message, kind: 'interaction' }),
    ...resultActions,
  };
}
