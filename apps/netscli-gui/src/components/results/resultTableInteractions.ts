import type { Dispatch, KeyboardEvent, MouseEvent, PointerEvent, SetStateAction } from 'react';

import { copyContextForCell } from '../../tools/presentation';
import type { ResultCellContext, ResultColumn, ResultRow, RowSelectionMode } from '../../tools/types';

export interface TableOverflowState {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  vertical: boolean;
  horizontal: boolean;
}

export function selectionModeForPointer(event: MouseEvent<HTMLTableRowElement>): RowSelectionMode {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'single';
}

export function openCellContextMenu(
  event: MouseEvent<HTMLElement>,
  row: ResultRow,
  index: number,
  column: ResultColumn,
  selected: boolean,
  onSelectRow: (index: number, mode?: RowSelectionMode) => void,
  onContentContextMenu: (event: MouseEvent<HTMLElement>, cell?: ResultCellContext) => void,
) {
  event.stopPropagation();
  if (!selected) onSelectRow(index, 'single');
  onContentContextMenu(event, copyContextForCell(row, column) ?? undefined);
}

export function updateOverflowState(
  element: HTMLDivElement | null,
  setOverflow: (state: TableOverflowState) => void,
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

export function handleColumnResizeKeyDown(
  event: KeyboardEvent<HTMLElement>,
  column: ResultColumn,
  setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>,
) {
  const step = event.shiftKey ? 48 : 16;
  const MIN = 72;
  const MAX = 640;

  // Each case returns the next width given the *current* one. It used to read
  // `column.width` -- the static column definition, not the live resized
  // value -- so every keypress recomputed from the same base and holding an
  // arrow key moved the border exactly one step and then stopped (M-2).
  let nextFrom: ((current: number) => number) | null = null;
  switch (event.key) {
    case 'ArrowLeft':
      nextFrom = (current) => Math.max(MIN, current - step);
      break;
    case 'ArrowRight':
      nextFrom = (current) => Math.min(MAX, current + step);
      break;
    case 'Home':
      nextFrom = () => MIN;
      break;
    case 'End':
      nextFrom = () => MAX;
      break;
    default:
      return;
  }

  event.preventDefault();
  setColumnWidths((prev) => {
    const current = prev[column.key] ?? column.width ?? 120;
    return { ...prev, [column.key]: nextFrom(current) };
  });
}

export function startColumnResize(
  event: PointerEvent,
  column: ResultColumn,
  setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>,
) {
  const startX = event.clientX;
  const header = (event.currentTarget as HTMLElement).closest('th');
  const startWidth = header?.getBoundingClientRect().width ?? column.width ?? 120;
  const pointerId = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(pointerId);

  function onMove(moveEvent: globalThis.PointerEvent) {
    const nextWidth = Math.max(72, Math.round(startWidth + moveEvent.clientX - startX));
    setColumnWidths((prev) => ({ ...prev, [column.key]: nextWidth }));
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

export function handleTableKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  selectedIndex: number,
  rowCount: number,
  onSelectAllRows: () => void,
  onSelectRow: (index: number, mode?: RowSelectionMode) => void,
) {
  if (rowCount === 0) return;

  const current = Math.min(Math.max(selectedIndex, 0), rowCount - 1);
  // No initialiser: every arm of the switch below either assigns `next` or
  // returns, so seeding it with `current` was dead (ESLint 10's
  // `no-useless-assignment`). Leaving it undeclared makes the compiler
  // enforce that property instead of hiding a missing case behind a
  // plausible-looking default.
  let next: number;
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (event.key === ' ' && ctrlOrMeta) {
    event.preventDefault();
    onSelectRow(current, 'toggle');
    return;
  }

  if (event.key.toLowerCase() === 'a' && ctrlOrMeta) {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    onSelectAllRows();
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      next = Math.min(current + 1, rowCount - 1);
      break;
    case 'ArrowUp':
      next = Math.max(current - 1, 0);
      break;
    case 'PageDown':
      next = Math.min(current + 10, rowCount - 1);
      break;
    case 'PageUp':
      next = Math.max(current - 10, 0);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = rowCount - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  if (next !== selectedIndex) {
    onSelectRow(next, event.shiftKey ? 'range' : ctrlOrMeta ? 'focus' : 'single');
  }
}
