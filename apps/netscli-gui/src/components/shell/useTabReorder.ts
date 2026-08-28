import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Pointer travel before a press becomes a drag, in px. */
const DRAG_THRESHOLD = 5;

const IDLE = {
  tabId: '',
  fromIndex: -1,
  pointerId: -1,
  startX: 0,
  dragging: false,
};

/**
 * Drag a tab along the strip to reorder it.
 *
 * Grabbing a tab reorders it; the strip's own drag-to-scroll
 * (`useTabStripDrag`) still applies to the space around the tabs, and the
 * wheel still scrolls either way. That split is what every tabbed
 * application does, and the alternative -- keeping drag-to-scroll on the
 * tabs themselves -- leaves no gesture for the thing people expect a tab
 * drag to do.
 *
 * The drop index is worked out from tab midpoints rather than by counting
 * pixels moved: the tabs are not a fixed width (each is sized by its label),
 * so a fixed step would drift the further you dragged.
 *
 * `onMove` is only called on release. Reordering live under the cursor looks
 * smoother but moves the element being dragged out from under the pointer,
 * which makes a long drag across several tabs fight itself.
 */
export function useTabReorder(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onMove: (tabId: string, toIndex: number) => void,
) {
  const state = useRef({ ...IDLE });
  const [dragging, setDragging] = useState<{ tabId: string; overIndex: number } | null>(null);

  /** Which slot the pointer is currently over, by tab midpoint. */
  function indexForClientX(clientX: number): number {
    const strip = scrollRef.current;
    if (!strip) return -1;
    const tabs = [...strip.querySelectorAll<HTMLElement>('.work-tab')];
    if (tabs.length === 0) return -1;
    for (let i = 0; i < tabs.length; i += 1) {
      const box = tabs[i].getBoundingClientRect();
      if (clientX < box.left + box.width / 2) return i;
    }
    return tabs.length - 1;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, tabId: string, index: number) {
    // Primary button only, and never a right-click: the context menu opens on
    // the same element and must not leave a half-started drag behind.
    if (event.button !== 0) return;
    // Stop the strip's drag-to-scroll from claiming this press.
    event.stopPropagation();
    state.current = { tabId, fromIndex: index, pointerId: event.pointerId, startX: event.clientX, dragging: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = state.current;
    if (current.pointerId !== event.pointerId || current.fromIndex < 0) return;

    if (!current.dragging) {
      if (Math.abs(event.clientX - current.startX) < DRAG_THRESHOLD) return;
      current.dragging = true;
      // Capture so the drag survives the pointer leaving the tab, which it
      // does immediately -- the tab is narrower than the distance travelled.
      //
      // Guarded: capture throws for a pointer the element does not own, and
      // the reorder must not abort halfway through because of it. That is not
      // hypothetical -- it is what a synthetic pointer id does, which is how
      // the render-automation harness drives this.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* not capturable; the drag still tracks via the move handler */
      }
    }

    const overIndex = indexForClientX(event.clientX);
    if (overIndex >= 0) setDragging({ tabId: current.tabId, overIndex });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = state.current;
    if (current.pointerId !== event.pointerId) return;
    const wasDragging = current.dragging;
    const { tabId } = current;
    const toIndex = wasDragging ? indexForClientX(event.clientX) : -1;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    state.current = { ...IDLE };
    setDragging(null);

    if (wasDragging && toIndex >= 0) onMove(tabId, toIndex);
    // Tell the strip whether to swallow the click this release produces. A
    // drag ends with a click on whatever is under the cursor, and that would
    // otherwise switch tabs at the end of every reorder.
    return wasDragging;
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (state.current.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    state.current = { ...IDLE };
    setDragging(null);
  }

  return { dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
