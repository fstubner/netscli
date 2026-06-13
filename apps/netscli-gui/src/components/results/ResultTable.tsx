import { Terminal } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
} from 'react';

import { copyContextForCell, renderValue } from '../../tools/presentation';
import type { ResultCellContext, ResultColumn, ResultRow, RowSelectionMode, WorkspaceTab } from '../../tools/types';
import type { PcapCapability } from '../../types/netscli';
import { PcapUnavailableState } from './PcapUnavailableState';
import { StatusPill } from './StatusPill';

interface ResultTableProps {
  activeTab: WorkspaceTab;
  columns: ResultColumn[];
  pcapCapability?: PcapCapability;
  rows: ResultRow[];
  onContentContextMenu: (event: MouseEvent<HTMLElement>, cell?: ResultCellContext) => void;
  onSelectAllRows: () => void;
  onSelectRow: (index: number, mode?: RowSelectionMode) => void;
  onSort: (column: ResultColumn) => void;
}

export function ResultTable({
  activeTab,
  columns,
  pcapCapability,
  rows,
  onContentContextMenu,
  onSelectAllRows,
  onSelectRow,
  onSort,
}: ResultTableProps) {
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [overflow, setOverflow] = useState({
    top: false,
    right: false,
    bottom: false,
    left: false,
    vertical: false,
    horizontal: false,
  });
  const effectiveColumns = useMemo(
    () => columns.map((column) => ({ ...column, width: columnWidths[column.key] ?? column.width })),
    [columns, columnWidths],
  );
  const selectedIndices = useMemo(
    () => new Set(activeTab.selectedIndices ?? [activeTab.selectedIndex]),
    [activeTab.selectedIndex, activeTab.selectedIndices],
  );

  useEffect(() => {
    tableShellRef.current
      ?.querySelector('tr.focused')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab.selectedIndex, rows.length]);

  useEffect(() => {
    updateOverflowState(tableShellRef.current, setOverflow);
  }, [rows.length, activeTab.result]);

  if (!activeTab.result) {
    if (activeTab.kind === 'pcap' && !activeTab.result && pcapCapability && !pcapCapability.available) {
      return <PcapUnavailableState capability={pcapCapability} />;
    }

    return (
      <div className="empty-workspace" tabIndex={0} onContextMenu={onContentContextMenu}>
        <Terminal size={28} />
        <span>No results</span>
      </div>
    );
  }

  return (
    <div
      aria-label={`${activeTab.kind} results`}
      className={[
        'table-shell',
        overflow.vertical ? 'has-vertical-overflow' : '',
        overflow.horizontal ? 'has-horizontal-overflow' : '',
        overflow.top ? 'has-top-overflow' : '',
        overflow.right ? 'has-right-overflow' : '',
        overflow.bottom ? 'has-bottom-overflow' : '',
        overflow.left ? 'has-left-overflow' : '',
      ].filter(Boolean).join(' ')}
      data-testid="result-table"
      ref={tableShellRef}
      role="grid"
      aria-multiselectable="true"
      tabIndex={0}
      onScroll={() => updateOverflowState(tableShellRef.current, setOverflow)}
      onContextMenu={onContentContextMenu}
      onKeyDown={(event) => handleTableKeyDown(event, activeTab.selectedIndex, rows.length, onSelectAllRows, onSelectRow)}
    >
      <span className="table-overflow-shadow top" aria-hidden="true" />
      <span className="table-overflow-shadow right" aria-hidden="true" />
      <span className="table-overflow-shadow bottom" aria-hidden="true" />
      <span className="table-overflow-shadow left" aria-hidden="true" />
      <table className="result-table">
        <colgroup>
          {effectiveColumns.map((column) => (
            <col key={column.key} style={column.width ? { width: `${column.width}px` } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {effectiveColumns.map((column) => (
              <th className={column.grow ? 'grow' : ''} key={column.key}>
                <button onClick={() => onSort(column)}>
                  <span>{column.label}</span>
                  {activeTab.sortKey === column.key && (
                    <span className="sort-marker">{activeTab.sortDir === 'asc' ? '^' : 'v'}</span>
                  )}
                </button>
                <span
                  className="column-resizer"
                  role="separator"
                  aria-label={`Resize ${column.label} column`}
                  aria-orientation="vertical"
                  aria-valuemax={640}
                  aria-valuemin={72}
                  aria-valuenow={column.width ?? 120}
                  tabIndex={0}
                  onKeyDown={(event) => handleColumnResizeKeyDown(event, column, setColumnWidths)}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    startColumnResize(event, column, setColumnWidths);
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = selectedIndices.has(index);
            const focused = index === activeTab.selectedIndex;
            return (
              <tr
                aria-selected={selected}
                className={[selected ? 'selected' : '', focused ? 'focused' : ''].filter(Boolean).join(' ')}
                data-testid={`result-row-${row.data.port ?? row.id}`}
                key={row.id}
                tabIndex={-1}
                onClick={(event) => onSelectRow(index, selectionModeForPointer(event))}
              >
                {effectiveColumns.map((column) => {
                  const value = row.data[column.key];
                  if (column.key === 'status' || column.key === 'state') {
                    return (
                      <td
                        key={column.key}
                        onContextMenu={(event) =>
                          openCellContextMenu(event, row, index, column, selected, onSelectRow, onContentContextMenu)
                        }
                      >
                        <StatusPill value={value} />
                      </td>
                    );
                  }
                  return (
                    <td
                      className={column.mono ? 'mono' : ''}
                      key={column.key}
                      onContextMenu={(event) =>
                        openCellContextMenu(event, row, index, column, selected, onSelectRow, onContentContextMenu)
                      }
                    >
                      {renderValue(value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty-filter">No rows match the current filter.</div>}
    </div>
  );
}

function selectionModeForPointer(event: MouseEvent<HTMLTableRowElement>): RowSelectionMode {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'single';
}

function openCellContextMenu(
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

function updateOverflowState(
  element: HTMLDivElement | null,
  setOverflow: (state: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
    vertical: boolean;
    horizontal: boolean;
  }) => void,
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

function handleColumnResizeKeyDown(
  event: KeyboardEvent<HTMLElement>,
  column: ResultColumn,
  setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>,
) {
  const step = event.shiftKey ? 48 : 16;
  let nextWidth: number | null = null;

  switch (event.key) {
    case 'ArrowLeft':
      nextWidth = Math.max(72, (column.width ?? 120) - step);
      break;
    case 'ArrowRight':
      nextWidth = Math.min(640, (column.width ?? 120) + step);
      break;
    case 'Home':
      nextWidth = 72;
      break;
    case 'End':
      nextWidth = 640;
      break;
    default:
      return;
  }

  event.preventDefault();
  setColumnWidths((prev) => ({ ...prev, [column.key]: nextWidth }));
}

function startColumnResize(
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

function handleTableKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  selectedIndex: number,
  rowCount: number,
  onSelectAllRows: () => void,
  onSelectRow: (index: number, mode?: RowSelectionMode) => void,
) {
  if (rowCount === 0) return;

  const current = Math.min(Math.max(selectedIndex, 0), rowCount - 1);
  let next = current;
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
