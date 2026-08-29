import { useEffect } from 'react';

import * as netscli from '../services/netscli';
import { isTauri } from '../services/env';
import { applyProgressUpdate } from './traceProgress';
import type { WorkspaceTab } from '../tools/types';
import type { WorkspaceToast } from './types';

interface UseOperationProgressArgs {
  /** Live map of tab id to in-flight operation id, owned by useTabLifecycle. */
  activeOps: { current: Record<string, string> };
  setTabs: (update: (prev: WorkspaceTab[]) => WorkspaceTab[]) => void;
  showToast: (toast: Omit<WorkspaceToast, 'id'>) => void;
}

/**
 * Route operation-progress events from the backend onto the tab that started
 * them.
 *
 * Split out of useWorkspace, which was at its size cap. It is a self-contained
 * concern: one subscription, set up once for the life of the component, with
 * its own teardown and its own failure handling.
 */
export function useOperationProgress({ activeOps, setTabs, showToast }: UseOperationProgressArgs) {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void netscli
      .listenOperationProgress((progress) => {
        const tabId = Object.entries(activeOps.current).find(([, opId]) => opId === progress.op_id)?.[0];
        if (!tabId) return;
        setTabs((prev) => prev.map((tab) => (tab.id === tabId ? applyProgressUpdate(tab, progress) : tab)));
      })
      .then((dispose) => {
        if (cancelled) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      // Without this, a rejected `listen()` left every later operation
      // silently reporting no progress, with nothing surfaced to the user
      // (B-15). Every other Tauri call in the codebase is already guarded.
      .catch((error: unknown) => {
        showToast({
          kind: 'error',
          message: `Progress updates unavailable: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // Must run exactly once. `showToast` is rebuilt every render, so
    // depending on it would tear down and re-register the Tauri listener
    // continuously; `activeOps` is a `useRef` from `useTabLifecycle`, stable
    // for the component's life, but the rule cannot see that across the hook
    // boundary. Reading `activeOps.current` inside the callback is what makes
    // the empty dep list correct rather than merely convenient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
