import type { Dispatch, SetStateAction } from 'react';

import * as netscli from '../services/netscli';
import { createTab, TOOL_CONFIG } from '../tools/registry';
import type { ResultColumn, ResultRow, WorkspaceTab } from '../tools/types';
import {
  buildResultBundle,
  formatRowsDetails,
  formatRowsRaw,
  exportCurrentResult,
  exportSelectedRows,
  parseResultBundle,
} from './transfer';
import type { WorkspaceToast } from './types';

interface UseResultActionsArgs {
  activeTab: WorkspaceTab | undefined;
  columns: ResultColumn[];
  rows: ResultRow[];
  selectedRow: ResultRow | undefined;
  selectedRows: ResultRow[];
  commandPreview: string;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setActiveTabId: (tabId: string) => void;
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void;
}

/** Everything that acts on the active/selected result: export, copy, and
 *  the result-bundle save/open round trip. Doesn't own any state of its
 *  own beyond what's passed in — tabs/selection stay in useWorkspace since
 *  they're needed by far more than just these actions. */
export function useResultActions({
  activeTab,
  columns,
  rows,
  selectedRow,
  selectedRows,
  commandPreview,
  setTabs,
  setActiveTabId,
  showToast,
}: UseResultActionsArgs) {
  function showExportToast(path: string | null | undefined, fallback: string) {
    if (path === undefined) return;
    showToast({ message: path ? `Exported to ${path}` : fallback, kind: 'interaction' });
  }

  function showExportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showToast({ message: `Export failed: ${message}`, kind: 'interaction' });
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
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      showToast({ message: 'Result bundle opened', kind: 'interaction' });
    } catch (error) {
      if (!/cancelled/i.test(String(error))) {
        showToast({ message: `Open failed: ${String(error)}`, kind: 'interaction' });
      }
    }
  }

  /**
   * Copy text, reporting whether it actually landed.
   *
   * The previous shape — `navigator.clipboard?.writeText(x).catch(() =>
   * undefined)` followed by an unconditional "copied" toast — reported
   * success in two failing cases: a rejected write (swallowed by the catch)
   * and a missing `navigator.clipboard` (the optional chain made it a silent
   * no-op). The export path already reports its failures; this matches it.
   */
  async function copyToClipboard(label: string, text: string) {
    if (!navigator.clipboard) {
      showToast({ message: `${label} failed: clipboard unavailable`, kind: 'interaction' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast({ message: `${label} copied`, kind: 'interaction' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ message: `${label} copy failed: ${message}`, kind: 'interaction' });
    }
  }

  async function copyCommand() {
    if (!commandPreview) return;
    await copyToClipboard('Command', commandPreview);
  }

  async function copyCellValue(label: string, value: string) {
    if (!value) return;
    await copyToClipboard(label, value);
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
    const label = rowsToCopy.length === 1 ? 'Details' : `${rowsToCopy.length} rows`;
    await copyToClipboard(label, formatRowsDetails(rowsToCopy));
  }

  async function copySelectedRaw() {
    const rowsToCopy = selectedRows.length > 0 ? selectedRows : selectedRow ? [selectedRow] : [];
    if (rowsToCopy.length === 0) return;
    const label = rowsToCopy.length === 1 ? 'Raw row' : `Raw ${rowsToCopy.length} rows`;
    await copyToClipboard(label, formatRowsRaw(rowsToCopy));
  }

  return {
    exportCurrent,
    exportSelectedCsv,
    exportSelectedJson,
    saveResultBundle,
    openResultBundle,
    copyCommand,
    copyCellValue,
    openCaptureFile,
    revealCaptureFile,
    copySelectedDetails,
    copySelectedRaw,
  };
}
