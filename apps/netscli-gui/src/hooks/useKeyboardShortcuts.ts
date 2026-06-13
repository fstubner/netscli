import { useEffect } from 'react';

import type { WorkspaceModel } from '../workspace/types';

export function useKeyboardShortcuts({
  focusResultFilter,
  openMenu,
  setOpenMenu,
  setSettingsOpen,
  settingsOpen,
  setWorkspaceSearchOpen,
  workspace,
  workspaceSearchOpen,
}: {
  focusResultFilter: () => void;
  openMenu: string | null;
  setOpenMenu: (menu: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setWorkspaceSearchOpen: (open: boolean) => void;
  workspace: WorkspaceModel;
  workspaceSearchOpen: boolean;
}) {
  const activeTab = workspace.activeTab;

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
        void workspace.runTab(activeTab.id);
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

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => document.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [
    activeTab,
    focusResultFilter,
    openMenu,
    setOpenMenu,
    setSettingsOpen,
    settingsOpen,
    setWorkspaceSearchOpen,
    workspace,
    workspaceSearchOpen,
  ]);
}

