import { useEffect, useMemo, useState } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import { createTab, defaultDetailTab } from '../tools/registry';
import { buildCommand, buildRows, columnsFor, filterAndSortRows } from '../tools/presentation';
import type { HistoryEntry, ResultColumn, RowSelectionMode, WorkspaceTab } from '../tools/types';
import { applyContextDefaults } from './networkDefaults';
import { createDemoScreenshotTabs, isDemoScreenshotMode } from './demoMode';
import { cancelWorkspaceTab, runWorkspaceTab } from './operations';
import { clampIndex, normalizeSelection, rangeBetween } from './selection';
import { loadHistory, saveHistory } from './historyStorage';
import { enrichInterfaceRows } from './interfaceRows';
import { applyProgressUpdate } from './traceProgress';
import { useResultActions } from './useResultActions';
import { useTabLifecycle } from './useTabLifecycle';
import type { WorkspaceModel, WorkspaceOptions } from './types';
import { useNetworkStatus } from './useNetworkStatus';
import { useWorkspaceToast } from './useWorkspaceToast';

export function useWorkspace(options: WorkspaceOptions): WorkspaceModel {
  const demoScreenshotMode = isDemoScreenshotMode();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    demoScreenshotMode ? createDemoScreenshotTabs() : [createTab('scan')],
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

  useEffect(() => {
    if (!activeTab) return;
    patchTab(activeTab.id, {
      selectedIndex: 0,
      selectedIndices: [0],
      selectionAnchor: 0,
    });
  }, [activeTab?.sortDir, activeTab?.sortKey, filterText]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void netscli.listenOperationProgress((progress) => {
      const tabId = Object.entries(activeOps.current).find(([, opId]) => opId === progress.op_id)?.[0];
      if (!tabId) return;
      setTabs((prev) => prev.map((tab) => (tab.id === tabId ? applyProgressUpdate(tab, progress) : tab)));
    }).then((dispose) => {
      if (cancelled) {
        dispose();
      } else {
        unlisten = dispose;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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

  function selectAllRows() {
    if (!activeTab || rows.length === 0) return;
    patchTab(activeTab.id, {
      selectedIndex: 0,
      selectedIndices: rows.map((_row, index) => index),
      selectionAnchor: 0,
      detailTab: rows.length > 1 ? 'selection' : activeTab.detailTab,
    });
  }

  function closeOtherTabs() {
    closeOtherTabsFor(activeTab);
  }

  async function runTab(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (toast?.kind === 'operation') {
      dismissToast();
    }
    await runWorkspaceTab({
      activeOps,
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
    selectAllRows,
    addTab,
    openHostTool,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
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
