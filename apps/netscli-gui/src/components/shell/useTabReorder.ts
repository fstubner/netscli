import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { tabDropIndex } from './tabDropIndex';

/** Pointer travel before a press becomes a drag, in px. */
const DRAG_THRESHOLD = 5;

const IDLE = {
  tabId: '',
  fromIndex: -1,
  /** Where the tab sits now — it moves as you drag, so this is not fromIndex. */
  currentIndex: -1,
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
 * The strip reorders live: the tab moves as you cross each neighbour rather
 * than jumping into place on release. That is what makes the drag feel
 * attached to the pointer, and it is why `tabDropIndex` ignores the dragged
 * tab when deciding — feeding a live reorder back through a naive midpoint
 * test flickers the tab between two slots for as long as you hold it.
 *
 * A cancelled gesture puts the tab back where it started, since by then it
 * has already moved several times.
 */
export function useTabReorder(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onMove: (tabId: string, toIndex: number) => void,
) {
  const state = useRef({ ...IDLE });
  const [dragging, setDragging] = useState<{ tabId: string } | null>(null);

  /** Where the dragged tab belongs for this pointer position. */
  function slotFor(clientX: number, draggedIndex: number): number {
    const strip = scrollRef.current;
    if (!strip) return -1;
    const boxes = [...strip.querySelectorAll<HTMLElement>('.work-tab')].map((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, width: box.width };
    });
    return tabDropIndex(boxes, draggedIndex, clientX);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, tabId: string, index: number) {
    // Primary button only, and never a right-click: the context menu opens on
    // the same element and must not leave a half-started drag behind.
    if (event.button !== 0) return;
    // Stop the strip's drag-to-scroll from claiming this press.
    event.stopPropagation();
    state.current = {
      tabId,
      fromIndex: index,
      currentIndex: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      dragging: false,
    };
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
      setDragging({ tabId: current.tabId });
    }

    const slot = slotFor(event.clientX, current.currentIndex);
    if (slot >= 0 && slot !== current.currentIndex) {
      current.currentIndex = slot;
      onMove(current.tabId, slot);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = state.current;
    if (current.pointerId !== event.pointerId) return;
    const wasDragging = current.dragging;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    state.current = { ...IDLE };
    setDragging(null);

    // Nothing to commit -- the moves already happened. Tell the strip whether
    // to swallow the click this release produces. A
    // drag ends with a click on whatever is under the cursor, and that would
    // otherwise switch tabs at the end of every reorder.
    return wasDragging;
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const current = state.current;
    if (current.pointerId !== event.pointerId) return;
    // Put it back. A cancelled drag has usually moved the tab several times
    // already, so leaving it wherever the gesture died is not "cancel".
    if (current.dragging && current.currentIndex !== current.fromIndex) {
      onMove(current.tabId, current.fromIndex);
    }
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
