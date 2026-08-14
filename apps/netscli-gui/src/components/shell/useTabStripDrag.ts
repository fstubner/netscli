import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

const IDLE = {
  active: false,
  captured: false,
  startX: 0,
  scrollLeft: 0,
  moved: false,
  pointerId: 0,
};

/**
 * Drag-to-scroll and wheel-to-scroll for the tab strip.
 *
 * Extracted from `TabStrip.tsx` to keep it under the maintainability cap.
 * It is a clean seam: nothing here touches tab state, only the scroll
 * container's position.
 *
 * `suppressNextClick` exists because a drag ends with a click on whichever
 * tab is under the cursor; the strip checks it to avoid switching tabs when
 * the user was only scrolling.
 */
export function useTabStripDrag(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onScrollChange: () => void,
) {
  const dragState = useRef({ ...IDLE });
  const suppressNextClick = useRef(false);

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? scroll.clientWidth
          : 1;
    scroll.scrollBy({ left: event.deltaY * unit, behavior: 'smooth' });
    event.preventDefault();
    window.requestAnimationFrame(onScrollChange);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const scroll = scrollRef.current;
    if (!scroll || scroll.scrollWidth <= scroll.clientWidth + 1) return;
    dragState.current = {
      ...IDLE,
      active: true,
      startX: event.clientX,
      scrollLeft: scroll.scrollLeft,
      pointerId: event.pointerId,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    const scroll = scrollRef.current;
    if (!state.active || !scroll) return;
    const delta = event.clientX - state.startX;
    if (Math.abs(delta) <= 6 && !state.moved) return;
    state.moved = true;
    if (!state.captured) {
      scroll.setPointerCapture(event.pointerId);
      state.captured = true;
    }
    scroll.scrollLeft = state.scrollLeft - delta;
    event.preventDefault();
    onScrollChange();
  }

  function releaseCapture(pointerId: number) {
    if (dragState.current.captured && scrollRef.current?.hasPointerCapture(pointerId)) {
      scrollRef.current.releasePointerCapture(pointerId);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const moved = dragState.current.active && dragState.current.moved;
    releaseCapture(event.pointerId);
    dragState.current = { ...IDLE };
    if (!moved) return;
    suppressNextClick.current = true;
    window.setTimeout(() => {
      suppressNextClick.current = false;
    }, 0);
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    releaseCapture(event.pointerId);
    dragState.current = { ...IDLE };
  }

  return {
    suppressNextClick,
    dragHandlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
