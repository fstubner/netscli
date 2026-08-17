import {
  useEffect,
  useLayoutEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusFirstInteractive(container: HTMLElement | null) {
  const target = focusableElements(container)[0] ?? container;
  target?.focus({ preventScroll: true });
}

export function useModalFocus({
  dialogRef,
  enabled = true,
  onClose,
}: {
  dialogRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  onClose: () => void;
}) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusFirstInteractive(dialogRef.current);
    return () => previous?.focus({ preventScroll: true });
  }, [dialogRef, enabled]);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const items = focusableElements(dialogRef.current);
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogRef, enabled, onClose]);
}

export function useRovingFocus({
  containerRef,
  enabled,
  itemSelector = 'button:not(:disabled)',
  onClose,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  itemSelector?: string;
  onClose?: () => void;
}) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const items = rovingItems(container, itemSelector);
    const selected =
      items.find((item) => item.getAttribute('aria-selected') === 'true' || item.classList.contains('selected')) ??
      items[0];
    selected?.focus({ preventScroll: true });
  }, [containerRef, enabled, itemSelector]);

  return (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    const items = rovingItems(containerRef.current, itemSelector);
    if (items.length === 0) return;

    const activeIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    // No initialiser — see the note in resultTableInteractions.ts. Every
    // switch arm assigns or returns, so seeding this was dead code.
    let nextIndex: number;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIndex = (activeIndex + 1) % items.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIndex = (activeIndex - 1 + items.length) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        onClose?.();
        return;
      default:
        return;
    }

    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
  };
}

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

function rovingItems(container: HTMLElement | null, selector: string): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true',
  );
}
