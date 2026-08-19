import type { DefaultInterfaceInfo, InterfaceInfo, NetworkStats } from '../types/netscli';
import type { HistoryEntry, ResultColumn, ResultRow, RowSelectionMode, ToolKind, WorkspaceTab } from '../tools/types';

export interface WorkspaceModel {
  tabs: WorkspaceTab[];
  activeTab: WorkspaceTab | undefined;
  activeTabId: string;
  filterText: string;
  toast: WorkspaceToast | null;
  history: HistoryEntry[];
  networkStats: NetworkStats | null;
  defaultInterface: DefaultInterfaceInfo | null;
  trafficInterface: DefaultInterfaceInfo | null;
  trafficInterfaceName: string | null;
  interfaces: InterfaceInfo[];
  rows: ResultRow[];
  selectedRow: ResultRow | undefined;
  selectedRows: ResultRow[];
  columns: ResultColumn[];
  commandPreview: string;
  setActiveTabId: (tabId: string) => void;
  setFilterText: (filterText: string) => void;
  setTrafficInterfaceName: (name: string) => void;
  dismissToast: () => void;
  showUpdateToast: (version: string, url: string) => void;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  patchForm: (id: string, key: string, value: string) => void;
  selectRow: (index: number, mode?: RowSelectionMode) => void;
  /** Select a row in a named tab, which need not be the active one. */
  selectRowInTab: (tabId: string, rowId: string) => void;
  selectAllRows: () => void;
  addTab: (kind: ToolKind) => void;
  openHostTool: (kind: 'scan' | 'inspect', host: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: () => void;
  /** Whether this tab was auto-created (e.g. interfaces/arp) and still
   *  needs its first run triggered. App.tsx's own requestRun (which applies
   *  operation guards and capability checks) watches this and calls
   *  clearAutoRun once it has acted on it — kept out of this hook so
   *  auto-run still goes through the same guard path as a manual run. */
  needsAutoRun: (tabId: string) => boolean;
  clearAutoRun: (tabId: string) => void;
  runTab: (tabId: string) => Promise<void>;
  cancelTab: (tabId: string) => Promise<void>;
  exportCurrent: (format: 'json' | 'csv') => void;
  exportSelectedJson: () => void;
  exportSelectedCsv: () => void;
  saveResultBundle: () => Promise<void>;
  openResultBundle: () => Promise<void>;
  copyCellValue: (label: string, value: string) => Promise<void>;
  openCaptureFile: (path: string) => Promise<void>;
  revealCaptureFile: (path: string) => Promise<void>;
  copyCommand: () => Promise<void>;
  copySelectedDetails: () => Promise<void>;
  copySelectedRaw: () => Promise<void>;
  sortBy: (column: ResultColumn) => void;
  openHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
  clearCurrentResults: () => void;
  showInteractionToast: (message: string) => void;
  statusInterfaceInfo: DefaultInterfaceInfo | null;
}

export interface WorkspaceOptions {
  interactionToasts: boolean;
  maxConcurrentProbes: number;
  operationToasts: boolean;
  persistentHistory: boolean;
}

export interface WorkspaceToast {
  id: string;
  message: string;
  kind: 'interaction' | 'operation' | 'update';
  tabId?: string;
  persistent?: boolean;
  actionUrl?: string;
  releaseVersion?: string;
}
