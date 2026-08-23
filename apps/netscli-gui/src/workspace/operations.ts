import type { Dispatch, RefObject, SetStateAction } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import { defaultDetailTab, generateId, TOOL_CONFIG } from '../tools/registry';
import { buildCommand } from '../tools/presentation';
import type { HistoryEntry, WorkspaceTab } from '../tools/types';
import { compactHistory } from './historyStorage';
import { executeTool, validateTab } from './toolExecution';
import type { WorkspaceToast } from './types';

interface RunWorkspaceTabArgs {
  activeOps: RefObject<Record<string, string>>;
  maxConcurrentProbes: number;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  persistentHistory: boolean;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void;
  tab: WorkspaceTab | undefined;
}

export async function runWorkspaceTab({
  activeOps,
  maxConcurrentProbes,
  patchTab,
  persistentHistory,
  setHistory,
  showToast,
  tab,
}: RunWorkspaceTabArgs) {
  if (!tab || tab.busy) return;

  const validation = validateTab(tab);
  if (validation) {
    patchTab(tab.id, { error: validation });
    return;
  }

  const opId = generateId('op');
  activeOps.current[tab.id] = opId;
  patchTab(tab.id, {
    busy: true,
    error: null,
    progress: {
      kind: tab.kind,
      completed: 0,
      total: 0,
      found: 0,
      detail: initialProgressDetail(tab),
    },
    result: null,
    selectedIndex: 0,
    selectedIndices: [0],
    selectionAnchor: 0,
  });

  try {
    const result = await executeTool(tab, opId, maxConcurrentProbes);
    if (activeOps.current[tab.id] !== opId) return;
    patchTab(tab.id, {
      result,
      busy: false,
      progress: null,
      selectedIndex: 0,
      selectedIndices: [0],
      selectionAnchor: 0,
      detailTab: defaultDetailTab(tab.kind),
    });
    // No toast for success. The result arriving in the table is the
    // completion signal, and announcing it again told the user something
    // they were already looking at -- on a tab that auto-runs, before they
    // had done anything at all. Failure still toasts below, because there
    // the table stays empty and the reason would otherwise be invisible.
    if (persistentHistory) {
      setHistory((prev) =>
        compactHistory([
          {
            id: generateId('history'),
            timestamp: new Date(),
            tabTitle: tab.title,
            command: buildCommand(tab),
            form: { ...tab.form },
            result,
          },
          ...prev,
        ]),
      );
    }
  } catch (error) {
    if (activeOps.current[tab.id] !== opId) return;
    const message = error instanceof Error ? error.message : String(error);
    patchTab(tab.id, { error: message, busy: false, progress: null, result: null });
    showToast({
      message: `${TOOL_CONFIG[tab.kind].label} failed: ${message}`,
      kind: 'operation',
      tabId: tab.id,
    });
  } finally {
    if (activeOps.current[tab.id] === opId) {
      delete activeOps.current[tab.id];
    }
  }
}

export async function cancelWorkspaceTab(
  tabId: string,
  activeOps: RefObject<Record<string, string>>,
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void,
) {
  const opId = activeOps.current[tabId];
  if (opId && isTauri()) {
    await netscli.cancelOperation(opId).catch(() => undefined);
  }
  delete activeOps.current[tabId];
  patchTab(tabId, { busy: false, progress: null, error: null });
}

function initialProgressDetail(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'scan':
      return 'Preparing port probes';
    case 'ping':
      return 'Sending probes';
    case 'trace':
      return 'Starting route trace';
    case 'discover':
      return 'Preparing host discovery';
    case 'dns':
    case 'reverse':
      return 'Querying DNS';
    case 'sweep':
      return 'Preparing network sweep';
    case 'mdns':
      return 'Listening for mDNS services';
    case 'pcap':
      return tab.form.mode === 'Open File' ? 'Opening capture file' : 'Starting packet capture';
    case 'inspect':
      return 'Inspecting host';
    case 'interfaces':
      return 'Refreshing interfaces';
    case 'arp':
      return 'Reading ARP table';
    default: {
      const kind: never = tab.kind;
      return kind;
    }
  }
}
