import { useEffect, useRef } from 'react';

import type { WorkspaceModel } from '../workspace/types';

export function useKeyboardShortcuts({
  focusResultFilter,
  openMenu,
  requestRun,
  setOpenMenu,
  setSettingsOpen,
  settingsOpen,
  setWorkspaceSearchOpen,
  workspace,
  workspaceSearchOpen,
}: {
  focusResultFilter: () => void;
  openMenu: string | null;
  requestRun: (tabId: string) => void;
  setOpenMenu: (menu: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setWorkspaceSearchOpen: (open: boolean) => void;
  workspace: WorkspaceModel;
  workspaceSearchOpen: boolean;
}) {
  const activeTab = workspace.activeTab;

  // The handler is rebuilt every render (it closes over props that change),
  // but the *listener* is attached once and reads the latest handler through
  // this ref.
  //
  // Previously the deps array included `workspace` — a fresh object on every
  // render — plus two fresh closures, so the 3-second network-stats poll
  // re-rendered App and detached/reattached a document-level keydown listener
  // continuously (B-18).
  const handlerRef = useRef<((event: KeyboardEvent) => void) | undefined>(undefined);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      return target instanceof HTMLElement && Boolean(target.closest('input,textarea,[contenteditable="true"]'));
    }

    function isScopedSelectTarget(target: EventTarget | null): boolean {
      return target instanceof HTMLElement && Boolean(target.closest('[data-testid="result-table"], .detail-body'));
    }

    function handleKeyboardShortcuts(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (ctrlOrMeta && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (activeTab && !settingsOpen && !workspaceSearchOpen) {
          setOpenMenu(null);
          focusResultFilter();
        }
        return;
      }

      if (ctrlOrMeta && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!settingsOpen) {
          setOpenMenu(null);
          setWorkspaceSearchOpen(true);
        }
        return;
      }

      if (event.key === 'Escape' && workspaceSearchOpen) {
        event.preventDefault();
        setWorkspaceSearchOpen(false);
        return;
      }

      if (event.key === 'Escape' && openMenu) {
        event.preventDefault();
        setOpenMenu(null);
        return;
      }

      if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }

      if (!activeTab || isEditableTarget(event.target)) return;

      if (ctrlOrMeta && event.key.toLowerCase() === 'a' && !isScopedSelectTarget(event.target)) {
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape' && activeTab.busy) {
        event.preventDefault();
        void workspace.cancelTab(activeTab.id);
        return;
      }

      if (!ctrlOrMeta) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        requestRun(activeTab.id);
        return;
      }

      if (!event.shiftKey) return;

      const key = event.key.toLowerCase();
      if (key === 'c') {
        event.preventDefault();
        void workspace.copyCommand();
      } else if (key === 'd') {
        event.preventDefault();
        void workspace.copySelectedDetails();
      } else if (key === 'r') {
        event.preventDefault();
        void workspace.copySelectedRaw();
      }
    }

    // No deps: this runs after every render and only assigns a ref, which is
    // far cheaper than swapping a DOM listener.
    handlerRef.current = handleKeyboardShortcuts;
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handlerRef.current?.(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
}

