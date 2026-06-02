import { useEffect } from 'react';

export function usePopoverDismissal({
  contentContextMenu,
  setContentContextMenu,
  openMenu,
  setOpenMenu,
}: {
  contentContextMenu: { x: number; y: number } | null;
  setContentContextMenu: (menu: { x: number; y: number } | null) => void;
  openMenu: string | null;
  setOpenMenu: (menu: string | null) => void;
}) {
  useEffect(() => {
    function suppressWebviewContextMenu(event: Event) {
      event.preventDefault();
    }

    document.addEventListener('contextmenu', suppressWebviewContextMenu);
    return () => document.removeEventListener('contextmenu', suppressWebviewContextMenu);
  }, []);

  useEffect(() => {
    if (!openMenu) return;

    function closePopoversOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpenMenu(null);
    }

    function isProtectedPopoverTarget(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      const protectedSelectors = ['.menu-root', '.menu-popover'];
      if (openMenu === 'new-tab') {
        protectedSelectors.push('.add-tab-group', '.tab-tool-popover');
      }
      if (openMenu === 'advanced-filter') {
        protectedSelectors.push('.filter-control', '.filter-advanced-popover');
      }
      return Boolean(target.closest(protectedSelectors.join(',')));
    }

    function closePopoversOnOutsidePointer(event: Event) {
      if (isProtectedPopoverTarget(event.target)) return;
      setOpenMenu(null);
    }

    document.addEventListener('keydown', closePopoversOnEscape, true);
    document.addEventListener('pointerdown', closePopoversOnOutsidePointer, true);
    document.addEventListener('mousedown', closePopoversOnOutsidePointer, true);
    document.addEventListener('click', closePopoversOnOutsidePointer, true);
    return () => {
      document.removeEventListener('keydown', closePopoversOnEscape, true);
      document.removeEventListener('pointerdown', closePopoversOnOutsidePointer, true);
      document.removeEventListener('mousedown', closePopoversOnOutsidePointer, true);
      document.removeEventListener('click', closePopoversOnOutsidePointer, true);
    };
  }, [openMenu, setOpenMenu]);

  useEffect(() => {
    if (!contentContextMenu) return;

    function closeContextMenuOnPointer(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.content-context-menu')) {
        setContentContextMenu(null);
      }
    }

    function closeContextMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setContentContextMenu(null);
    }

    document.addEventListener('pointerdown', closeContextMenuOnPointer);
    document.addEventListener('keydown', closeContextMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeContextMenuOnPointer);
      document.removeEventListener('keydown', closeContextMenuOnEscape);
    };
  }, [contentContextMenu, setContentContextMenu]);
}
