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
  /** Whether the user is looking at this tab *right now*. Must be read at
   *  completion, not when the run started: the point of the check is that
   *  they may have switched away during a long scan. */
  isTabActive: (tabId: string) => boolean;
  maxConcurrentProbes: number;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  persistentHistory: boolean;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void;
  tab: WorkspaceTab | undefined;
}

export async function runWorkspaceTab({
  activeOps,
  isTabActive,
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
    // Success toasts only for a tab the user is not looking at. On the
    // visible tab the result arriving in the table is itself the completion
    // signal, and announcing it again said something they could already see
    // -- on a tab that auto-runs, before they had done anything at all. On
    // a background tab there is no such signal, so the toast is the only
    // way to learn a long scan finished; `tabId` gives it an "Open tab"
    // action. Failure toasts unconditionally below: there the table stays
    // empty and the reason would otherwise be invisible either way.
    if (!isTabActive(tab.id)) {
      showToast({
        message: `${TOOL_CONFIG[tab.kind].label} complete`,
        kind: 'operation',
        tabId: tab.id,
      });
    }
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
  if (!opId || !isTauri()) {
    delete activeOps.current[tabId];
    patchTab(tabId, { busy: false, progress: null, error: null });
    return;
  }

  // Claim the cancel *before* awaiting the backend. The run's own completion
  // path guards on this id still matching, and the await is long enough for a
  // run to finish inside it -- which took the success path, wrote the result
  // and the history entry, and only then had the tab set idle underneath it.
  // The user pressed Stop and got a result. `cancelOperationIds` in
  // useTabLifecycle already ordered this correctly; the two disagreed.
  delete activeOps.current[tabId];

  try {
    await netscli.cancelOperation(opId);
  } catch (error) {
    // The backend refused the cancel, so the operation is still running.
    // Clearing `busy` here used to claim it had stopped, and dropping the id
    // meant Stop could never be pressed again -- the run became invisible and
    // uncancellable. Put the id back and say what happened.
    activeOps.current[tabId] = opId;
    // Deliberately not the backend's own message. What comes back here is
    // internal -- a Tauri command or argument error -- and means nothing to
    // the person reading it; the first version of this put
    // "invalid args `opId` for command `cancel_operation`" on screen. What
    // they need is that the run did not stop and that pressing Stop again is
    // worth trying. The detail goes to the console for a bug report.
    console.error('Stopping the operation failed', error);
    patchTab(tabId, {
      error: 'Could not stop the operation, so it may still be running. Try Stop again.',
    });
    return;
  }

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
