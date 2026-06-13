import { useEffect, useMemo, useRef, useState } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import { createTab, TOOL_CONFIG } from '../tools/registry';
import { buildCommand, buildRows, columnsFor, filterAndSortRows } from '../tools/presentation';
import type { ToolResult } from '../types/app';
import type { HistoryEntry, OperationProgressState, ResultColumn, RowSelectionMode, ToolKind, WorkspaceTab } from '../tools/types';
import { applyContextDefaults, shouldAutoRun } from './networkDefaults';
import { cancelWorkspaceTab, runWorkspaceTab } from './operations';
import { clampIndex, normalizeSelection, rangeBetween } from './selection';
import { loadHistory, saveHistory } from './historyStorage';
import {
  buildResultBundle,
  copyRowsDetails,
  copyRowsRaw,
  exportCurrentResult,
  exportSelectedRows,
  parseResultBundle,
} from './transfer';
import type { WorkspaceModel, WorkspaceOptions } from './types';
import { useNetworkStatus } from './useNetworkStatus';
import { useWorkspaceToast } from './useWorkspaceToast';

export function useWorkspace(options: WorkspaceOptions): WorkspaceModel {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [createTab('scan')]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const [filterText, setFilterText] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>(() => (options.persistentHistory ? loadHistory() : []));
  const activeOps = useRef<Record<string, string>>({});
  const autoRunTabIds = useRef<Set<string>>(new Set());
  const { dismissToast, showToast, showUpdateToast, toast } = useWorkspaceToast(options);
  const {
    defaultInterface,
    interfaces,
    networkStats,
    setTrafficInterfaceName,
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
    if (!activeTab || !autoRunTabIds.current.has(activeTab.id)) return;
    if (activeTab.busy || activeTab.result) return;
    autoRunTabIds.current.delete(activeTab.id);
    void runTab(activeTab.id);
  }, [activeTab?.id, activeTab?.busy, activeTab?.result]);

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

  function showExportToast(path: string | null | undefined, fallback: string) {
    if (path === undefined) return;
    showToast({ message: path ? `Exported to ${path}` : fallback, kind: 'interaction' });
  }

  function showExportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showToast({ message: `Export failed: ${message}`, kind: 'interaction' });
  }

  function patchTab(id: string, patch: Partial<WorkspaceTab>) {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }

  function patchForm(id: string, key: string, value: string) {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              detailTab: tab.kind === 'scan' ? 'banner' : tab.kind === 'inspect' ? 'overview' : 'details',
              error: null,
              form: { ...tab.form, [key]: value },
              result: null,
              selectedIndex: 0,
              selectedIndices: [0],
              selectionAnchor: 0,
            }
          : tab,
      ),
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

  function addTab(kind: ToolKind) {
    const tab = applyContextDefaults(createTab(kind), defaultInterface, trafficInterfaceName, interfaces);
    if (shouldAutoRun(kind)) {
      autoRunTabIds.current.add(tab.id);
    }
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function openHostTool(kind: 'scan' | 'inspect', host: string) {
    const value = host.trim();
    if (!value) return;
    const tab = applyContextDefaults(createTab(kind), defaultInterface, trafficInterfaceName, interfaces);
    tab.form = { ...tab.form, host: value };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function cancelOperationIds(tabIds: string[]) {
    for (const tabId of tabIds) {
      autoRunTabIds.current.delete(tabId);
      const opId = activeOps.current[tabId];
      if (opId && isTauri()) {
        void netscli.cancelOperation(opId).catch(() => undefined);
      }
      delete activeOps.current[tabId];
    }
  }

  function closeTab(id: string) {
    cancelOperationIds([id]);
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id);
      if (index < 0) return prev;
      const next = prev.filter((tab) => tab.id !== id);
      if (id === activeTabId) {
        const replacement = next[Math.max(0, index - 1)] ?? next[0];
        setActiveTabId(replacement?.id ?? '');
      }
      return next;
    });
  }

  function closeAllTabs() {
    cancelOperationIds(tabs.map((tab) => tab.id));
    setTabs([]);
    setActiveTabId('');
    setFilterText('');
  }

  function closeOtherTabs() {
    if (!activeTab) return;
    cancelOperationIds(tabs.filter((tab) => tab.id !== activeTab.id).map((tab) => tab.id));
    setTabs([activeTab]);
    setActiveTabId(activeTab.id);
  }

  async function runTab(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (toast?.kind === 'operation') {
      dismissToast();
    }
    await runWorkspaceTab({
      activeOps,
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

  function exportCurrent(format: 'json' | 'csv') {
    exportCurrentResult(activeTab, columns, rows, format, showExportToast, showExportError);
  }

  function exportSelectedCsv() {
    exportSelectedRows(activeTab, columns, selectedRows, 'csv', showExportToast, showExportError);
  }

  function exportSelectedJson() {
    exportSelectedRows(activeTab, columns, selectedRows, 'json', showExportToast, showExportError);
  }

  async function saveResultBundle() {
    if (!activeTab?.result) return;
    const bundle = buildResultBundle(activeTab, commandPreview);
    if (!bundle) return;
    try {
      const path = await netscli.saveResultBundle(JSON.stringify(bundle, null, 2));
      showExportToast(path, 'Saved result bundle');
    } catch (error) {
      if (!/cancelled/i.test(String(error))) showExportError(error);
    }
  }

  async function openResultBundle() {
    try {
      const bundle = parseResultBundle(await netscli.openResultBundle());
      if (!(bundle.kind in TOOL_CONFIG)) {
        throw new Error(`Unsupported tool kind '${bundle.kind}'`);
      }
      const tab = createTab(bundle.kind);
      tab.title = bundle.title || TOOL_CONFIG[bundle.kind].shortLabel;
      tab.form = { ...tab.form, ...bundle.form };
      tab.result = bundle.result;
      tab.detailTab = bundle.kind === 'scan' ? 'banner' : bundle.kind === 'inspect' ? 'overview' : 'details';
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      showToast({ message: 'Result bundle opened', kind: 'interaction' });
    } catch (error) {
      if (!/cancelled/i.test(String(error))) {
        showToast({ message: `Open failed: ${String(error)}`, kind: 'interaction' });
      }
    }
  }

  async function copyCommand() {
    if (!commandPreview) return;
    await navigator.clipboard?.writeText(commandPreview).catch(() => undefined);
    showToast({ message: 'Command copied', kind: 'interaction' });
  }

  async function copyCellValue(label: string, value: string) {
    if (!value) return;
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    showToast({ message: `${label} copied`, kind: 'interaction' });
  }

  async function openCaptureFile(path: string) {
    if (!path) return;
    await netscli.openFilesystemPath(path).catch((error) => {
      showToast({ message: `Open failed: ${String(error)}`, kind: 'interaction' });
    });
  }

  async function revealCaptureFile(path: string) {
    if (!path) return;
    await netscli.revealFilesystemPath(path).catch((error) => {
      showToast({ message: `Reveal failed: ${String(error)}`, kind: 'interaction' });
    });
  }

  async function copySelectedDetails() {
    const rowsToCopy = selectedRows.length > 0 ? selectedRows : selectedRow ? [selectedRow] : [];
    if (rowsToCopy.length === 0) return;
    await copyRowsDetails(rowsToCopy);
    showToast({
      message: rowsToCopy.length === 1 ? 'Details copied' : `${rowsToCopy.length} rows copied`,
      kind: 'interaction',
    });
  }

  async function copySelectedRaw() {
    const rowsToCopy = selectedRows.length > 0 ? selectedRows : selectedRow ? [selectedRow] : [];
    if (rowsToCopy.length === 0) return;
    await copyRowsRaw(rowsToCopy);
    showToast({
      message: rowsToCopy.length === 1 ? 'Raw row copied' : `Raw ${rowsToCopy.length} rows copied`,
      kind: 'interaction',
    });
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
    runTab,
    cancelTab,
    exportCurrent,
    exportSelectedJson,
    exportSelectedCsv,
    saveResultBundle,
    openResultBundle,
    copyCellValue,
    openCaptureFile,
    revealCaptureFile,
    copyCommand,
    copySelectedDetails,
    copySelectedRaw,
    sortBy,
    openHistoryEntry,
    clearHistory,
    clearCurrentResults,
  };
}

function applyProgressUpdate(tab: WorkspaceTab, progress: OperationProgressState): WorkspaceTab {
  if (tab.kind !== 'trace') {
    return { ...tab, progress };
  }

  const traceLine = traceLineFromProgress(progress.detail);
  if (!traceLine) {
    return { ...tab, progress };
  }

  const existing = tab.result?.kind === 'trace' ? tab.result : null;
  const lines = existing?.data.lines ?? [];
  if (lines.includes(traceLine)) {
    return { ...tab, progress };
  }

  const result: ToolResult = {
    kind: 'trace',
    data: {
      host: existing?.data.host ?? tab.form.host?.trim() ?? '',
      tool: existing?.data.tool ?? 'trace',
      exit_code: existing?.data.exit_code ?? null,
      lines: [...lines, traceLine],
    },
  };
  if (existing?.warnings) result.warnings = existing.warnings;

  return {
    ...tab,
    progress,
    result,
    selectedIndex: tab.result ? tab.selectedIndex : 0,
    selectedIndices: tab.result ? tab.selectedIndices : [0],
  };
}

function traceLineFromProgress(detail: string | null | undefined): string | null {
  const value = detail?.trim();
  if (!value) return null;
  const separator = ' - ';
  const line = value.includes(separator)
    ? value.slice(value.indexOf(separator) + separator.length).trim()
    : value;
  if (!line) return null;
  const firstToken = line.split(/\s+/)[0];
  return /^\d+$/.test(firstToken) ? line : null;
}

function enrichInterfaceRows(rows: ReturnType<typeof buildRows>, defaultName: string | undefined, selectedName: string | null) {
  if (rows.length === 0 || rows[0]?.kind !== 'interfaces') return rows;
  const activeName = selectedName || defaultName;
  return rows.map((row) => {
    const name = String(row.data.name ?? '');
    const labels = [
      activeName && name === activeName ? 'selected' : '',
      defaultName && name === defaultName ? 'default' : '',
    ].filter(Boolean);
    const data = { ...row.data, app: labels.join(', ') };
    return {
      ...row,
      data,
      searchText: Object.values(data).join(' ').toLowerCase(),
    };
  });
}
