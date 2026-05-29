import type { Dispatch, RefObject, SetStateAction } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import { generateId, TOOL_CONFIG } from '../tools/registry';
import { buildCommand } from '../tools/presentation';
import type { HistoryEntry, WorkspaceTab } from '../tools/types';
import { executeTool, validateTab } from './toolExecution';
import type { WorkspaceToast } from './types';

interface RunWorkspaceTabArgs {
  activeOps: RefObject<Record<string, string>>;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  persistentHistory: boolean;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void;
  tab: WorkspaceTab | undefined;
}

export async function runWorkspaceTab({
  activeOps,
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
    result: null,
    selectedIndex: 0,
    selectedIndices: [0],
    selectionAnchor: 0,
  });
  showToast({
    message: `${TOOL_CONFIG[tab.kind].label} started`,
    kind: 'operation',
    tabId: tab.id,
  });

  try {
    const result = await executeTool(tab, opId);
    if (activeOps.current[tab.id] !== opId) return;
    patchTab(tab.id, {
      result,
      busy: false,
      selectedIndex: 0,
      selectedIndices: [0],
      selectionAnchor: 0,
      detailTab: tab.kind === 'scan' ? 'banner' : 'details',
    });
    showToast({
      message: `${TOOL_CONFIG[tab.kind].label} complete`,
      kind: 'operation',
      tabId: tab.id,
    });
    if (persistentHistory) {
      setHistory((prev) =>
        [
          {
            id: generateId('history'),
            timestamp: new Date(),
            tabTitle: tab.title,
            command: buildCommand(tab),
            form: { ...tab.form },
            result,
          },
          ...prev,
        ].slice(0, 40),
      );
    }
  } catch (error) {
    if (activeOps.current[tab.id] !== opId) return;
    const message = error instanceof Error ? error.message : String(error);
    patchTab(tab.id, { error: message, busy: false, result: null });
    showToast({
      message: `${TOOL_CONFIG[tab.kind].label} failed`,
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
  tab: WorkspaceTab | undefined,
  activeOps: RefObject<Record<string, string>>,
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void,
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void,
) {
  const opId = activeOps.current[tabId];
  if (opId && isTauri()) {
    await netscli.cancelOperation(opId).catch(() => undefined);
  }
  delete activeOps.current[tabId];
  patchTab(tabId, { busy: false, error: 'Operation cancelled' });
  showToast({
    message: `${tab ? TOOL_CONFIG[tab.kind].label : 'Operation'} stopped`,
    kind: 'operation',
    tabId,
  });
}
