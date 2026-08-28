import { Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import { renderValue } from '../../tools/presentation';
import type { ResultCellContext, ResultColumn, ResultRow, RowSelectionMode, WorkspaceTab } from '../../tools/types';
import type { PcapCapability } from '../../types/netscli';
import { PcapUnavailableState } from './PcapUnavailableState';
import {
  handleColumnResizeKeyDown,
  handleTableKeyDown,
  openCellContextMenu,
  selectionModeForPointer,
  startColumnResize,
  updateOverflowState,
} from './resultTableInteractions';
import { StatusPill } from './StatusPill';

interface ResultTableProps {
  activeTab: WorkspaceTab;
  columns: ResultColumn[];
  /** Needed to tell "the filter hid everything" from "the run found
   *  nothing". Both produce zero rows and they are not the same news. */
  filterText: string;
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
  filterText,
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
    const shell = tableShellRef.current;
    updateOverflowState(shell, setOverflow);
    const frame = window.requestAnimationFrame(() => updateOverflowState(shell, setOverflow));
    const resizeObserver = shell ? new ResizeObserver(() => updateOverflowState(shell, setOverflow)) : null;
    if (shell) resizeObserver?.observe(shell);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
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
      onScroll={() => updateOverflowState(tableShellRef.current, setOverflow)}
      onContextMenu={onContentContextMenu}
    >
      {/*
        The grid role lives on the <table>, not on the scroll container
        (B-20). A `role="grid"` div whose only child is a table breaks row
        ownership: the rows belong to the table, so assistive tech saw a grid
        with no rows. Focus and key handling move here with it, since
        `aria-activedescendant` must sit on the focused element.
      */}
      <table
        className="result-table"
        role="grid"
        aria-multiselectable="true"
        aria-activedescendant={rows.length > 0 ? `result-row-${activeTab.selectedIndex}` : undefined}
        tabIndex={0}
        onKeyDown={(event) =>
          handleTableKeyDown(event, activeTab.selectedIndex, rows.length, onSelectAllRows, onSelectRow)
        }
      >
        <colgroup>
          {effectiveColumns.map((column) => (
            <col key={column.key} style={column.width ? { width: `${column.width}px` } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {effectiveColumns.map((column) => (
              <th
                className={column.grow ? 'grow' : ''}
                key={column.key}
                // Without this the sort state was visible only as a caret
                // glyph, which screen readers do not convey (B-20).
                aria-sort={
                  activeTab.sortKey === column.key
                    ? activeTab.sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
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
                // Referenced by the grid's aria-activedescendant so arrow-key
                // navigation is announced. Keyed by index, not row id,
                // because the selection is an index.
                id={`result-row-${index}`}
                key={row.id}
                tabIndex={-1}
                onClick={(event) => onSelectRow(index, selectionModeForPointer(event))}
              >
                {effectiveColumns.map((column) => {
                  // One `<td>`, not two near-identical ones. The branches
                  // differed only in the class and what went inside, but each
                  // carried its own copy of the seven-argument context-menu
                  // handler -- so a change to how a cell opens its menu had
                  // two places to remember.
                  const isStatus = column.key === 'status' || column.key === 'state';
                  const value = row.data[column.key];
                  return (
                    <td
                      className={!isStatus && column.mono ? 'mono' : ''}
                      key={column.key}
                      onContextMenu={(event) =>
                        openCellContextMenu(event, row, index, column, selected, onSelectRow, onContentContextMenu)
                      }
                    >
                      {isStatus ? <StatusPill value={value} /> : renderValue(value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="empty-filter">
          {/* This said "No rows match the current filter" whatever the reason,
              so a scan that legitimately found nothing sent people hunting
              for a filter they had never set. */}
          {filterText
            ? 'No rows match the current filter.'
            : 'This run completed and found nothing.'}
        </div>
      )}
    </div>
  );
}
