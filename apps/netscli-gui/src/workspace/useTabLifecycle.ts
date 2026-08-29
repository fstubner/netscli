import { useRef, type Dispatch, type SetStateAction } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import { createTab } from '../tools/registry';
import type { ToolKind, WorkspaceTab } from '../tools/types';
import type { DefaultInterfaceInfo, InterfaceInfo } from '../types/netscli';
import type { WorkspaceToast } from './types';
import { applyContextDefaults, shouldAutoRun } from './networkDefaults';

interface UseTabLifecycleArgs {
  tabs: WorkspaceTab[];
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  activeTabId: string;
  setActiveTabId: (tabId: string) => void;
  setFilterText: (filterText: string) => void;
  defaultInterface: DefaultInterfaceInfo | null;
  trafficInterfaceName: string | null;
  interfaces: InterfaceInfo[];
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void;
}

/** Tab CRUD (create/close) plus the auto-run flag that App.tsx's own
 *  requestRun effect consults — kept here alongside the tabs it applies to
 *  rather than routed back through a ref, since only this hook knows which
 *  tabs were auto-created and still need their first run triggered. */
export function useTabLifecycle({
  tabs,
  setTabs,
  activeTabId,
  setActiveTabId,
  setFilterText,
  defaultInterface,
  trafficInterfaceName,
  interfaces,
  showToast,
}: UseTabLifecycleArgs) {
  const activeOps = useRef<Record<string, string>>({});
  // Read at operation completion, not when the run started: a caller's
  // closure captures `activeTabId` as it was minutes earlier, and the
  // question "is the user looking at this tab" is only meaningful now.
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const autoRunTabIds = useRef<Set<string>>(new Set());

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
    // Choosing "Scan 192.168.1.5" from the result menu IS the request: the
    // one argument the tool needs came in with the click, so the tab opens
    // with nothing left to fill in and a Run press answers no question. This
    // is not `shouldAutoRun(kind)`, which asks whether a *blank* tab of this
    // kind can run on its own -- a scan tab opened empty still needs a host.
    autoRunTabIds.current.add(tab.id);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function cancelOperationIds(tabIds: string[]) {
    for (const tabId of tabIds) {
      autoRunTabIds.current.delete(tabId);
      const opId = activeOps.current[tabId];
      if (opId && isTauri()) {
        // A toast rather than an error strip: these tabs are being closed, so
        // there is no strip left to write to. It uses the ungated `error`
        // kind, because a swallowed failure here leaves an operation running
        // with no tab, no id and nothing on screen -- the run cannot be
        // stopped or even observed again.
        void netscli.cancelOperation(opId).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast({
            kind: 'error',
            message: `A closed tab's operation could not be stopped: ${message}`,
          });
        });
      }
      delete activeOps.current[tabId];
    }
  }

  function closeTab(id: string) {
    cancelOperationIds([id]);

    // The replacement id is computed out here rather than inside the
    // `setTabs` updater. React requires updaters to be pure, and calling
    // `setActiveTabId` from within one relied on that call being idempotent
    // — StrictMode double-invokes updaters in dev, and concurrent rendering
    // may replay them (B-17).
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (id === activeTabId) {
      const replacement = remaining[Math.max(0, index - 1)] ?? remaining[0];
      setActiveTabId(replacement?.id ?? '');
    }
    setTabs(remaining);
  }

  function closeAllTabs() {
    cancelOperationIds(tabs.map((tab) => tab.id));
    setTabs([]);
    setActiveTabId('');
    setFilterText('');
  }

  function closeOtherTabs(keep: WorkspaceTab | undefined) {
    if (!keep) return;
    cancelOperationIds(tabs.filter((tab) => tab.id !== keep.id).map((tab) => tab.id));
    setTabs([keep]);
    setActiveTabId(keep.id);
  }

  /**
   * Close every tab on one side of `id`, keeping `id` itself.
   *
   * Separate from `closeOtherTabs` because the tab a context menu acts on is
   * the one that was right-clicked, which is not necessarily the active one.
   * The kept tab becomes active when the active tab was among those closed --
   * the same rule `closeTab` follows, and what an editor does.
   */
  function closeTabsBeside(id: string, side: 'left' | 'right') {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const doomed = side === 'left' ? tabs.slice(0, index) : tabs.slice(index + 1);
    if (doomed.length === 0) return;

    cancelOperationIds(doomed.map((tab) => tab.id));
    const doomedIds = new Set(doomed.map((tab) => tab.id));
    const remaining = tabs.filter((tab) => !doomedIds.has(tab.id));
    if (doomedIds.has(activeTabId)) setActiveTabId(id);
    setTabs(remaining);
  }

  /**
   * Move a tab to a new position in the strip.
   *
   * Order is the array order -- nothing else stores it -- so this is a
   * splice. The active tab is unchanged: reordering moves where a tab sits,
   * not which one you are looking at, and a strip that switched tabs as you
   * dragged would fight the drag.
   */
  function moveTab(tabId: string, toIndex: number) {
    const from = tabs.findIndex((tab) => tab.id === tabId);
    if (from < 0) return;
    const to = Math.max(0, Math.min(tabs.length - 1, toIndex));
    if (from === to) return;

    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTabs(next);
  }

  function isTabActive(tabId: string): boolean {
    return activeTabIdRef.current === tabId;
  }

  function needsAutoRun(tabId: string): boolean {
    return autoRunTabIds.current.has(tabId);
  }

  function clearAutoRun(tabId: string): void {
    autoRunTabIds.current.delete(tabId);
  }

  return {
    activeOps,
    addTab,
    openHostTool,
    cancelOperationIds,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsBeside,
    moveTab,
    isTabActive,
    needsAutoRun,
    clearAutoRun,
  };
}
