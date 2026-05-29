import { useEffect } from 'react';

import type { WorkspaceModel } from '../workspace/types';

export function useKeyboardShortcuts({
  openMenu,
  setOpenMenu,
  setSettingsOpen,
  settingsOpen,
  workspace,
}: {
  openMenu: string | null;
  setOpenMenu: (menu: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  settingsOpen: boolean;
  workspace: WorkspaceModel;
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
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

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
  }, [activeTab, openMenu, setOpenMenu, setSettingsOpen, settingsOpen, workspace]);
}

