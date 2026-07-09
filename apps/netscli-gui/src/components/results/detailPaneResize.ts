import type { KeyboardEvent, PointerEvent } from 'react';

export type DetailPaneMode = 'normal' | 'collapsed' | 'expanded';

export interface DetailOverflowState {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  vertical: boolean;
  horizontal: boolean;
}

export function updateDetailOverflowState(
  element: HTMLDivElement | null,
  setOverflow: (state: DetailOverflowState) => void,
) {
  if (!element) return;
  const vertical = element.scrollHeight > element.clientHeight + 1;
  const horizontal = element.scrollWidth > element.clientWidth + 1;
  const top = element.scrollTop > 1;
  const left = element.scrollLeft > 1;
  const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
  setOverflow({ top, right, bottom, left, vertical, horizontal });
}

export function selectDetailBodyOnShortcut(event: KeyboardEvent<HTMLDivElement>) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
  event.preventDefault();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(event.currentTarget);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function startDetailResize(
  event: PointerEvent<HTMLDivElement>,
  setHeight: (height: number) => void,
  setMode: (mode: DetailPaneMode) => void,
) {
  event.preventDefault();
  const pane = event.currentTarget.parentElement;
  const startHeight = Math.round(pane?.getBoundingClientRect().height ?? 184);
  const startY = event.clientY;
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  target.setPointerCapture(event.pointerId);

  function onMove(moveEvent: globalThis.PointerEvent) {
    const rawHeight = Math.round(startHeight + startY - moveEvent.clientY);
    if (rawHeight < 78) {
      setMode('collapsed');
      return;
    }

    const next = Math.min(560, Math.max(96, rawHeight));
    setMode('normal');
    setHeight(next);
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

export function handleDetailResizeKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  height: number,
  setHeight: (height: number) => void,
  setMode: (mode: DetailPaneMode) => void,
) {
  const step = event.shiftKey ? 48 : 16;

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      setMode('normal');
      setHeight(Math.min(560, Math.max(96, height + step)));
      break;
    case 'ArrowDown': {
      event.preventDefault();
      const next = height - step;
      if (next < 78) {
        setMode('collapsed');
      } else {
        setMode('normal');
        setHeight(Math.max(96, next));
      }
      break;
    }
    case 'Home':
      event.preventDefault();
      setMode('collapsed');
      break;
    case 'End':
      event.preventDefault();
      setMode('expanded');
      break;
    default:
      break;
  }
}
