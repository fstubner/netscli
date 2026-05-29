import { ChevronDown, ChevronUp, Square } from 'lucide-react';
import {
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';

import {
  detailTabsFor,
  latencyOf,
  portBannerLines,
  portHeaderLines,
  portRawPreview,
  portTlsLines,
  renderValue,
  selectedRowsRawPreview,
  selectionSummaryLines,
} from '../../tools/presentation';
import type { DetailTab, ResultColumn, ResultRow, WorkspaceTab } from '../../tools/types';
import { JsonPreview } from './JsonPreview';

interface DetailPaneProps {
  activeTab: WorkspaceTab;
  columns: ResultColumn[];
  selectedRow: ResultRow | undefined;
  selectedRows: ResultRow[];
  onContentContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onSetDetailTab: (tab: DetailTab) => void;
}

function DetailList({ lines }: { lines: { label: string; value: string; muted?: boolean }[] }) {
  return (
    <div className="detail-list">
      {lines.map((line) => (
        <div className={`detail-line ${line.muted ? 'muted-line' : ''}`} key={`${line.label}-${line.value}`}>
          <span>{line.label}</span>
          <code>{line.value}</code>
        </div>
      ))}
    </div>
  );
}

function PortDetail({ detailTab, row }: { detailTab: DetailTab; row: ResultRow }) {
  const port = row.port;
  if (!port) return null;

  if (detailTab === 'headers') {
    return <DetailList lines={portHeaderLines(port)} />;
  }

  if (detailTab === 'tls') {
    return <DetailList lines={portTlsLines(port)} />;
  }

  if (detailTab === 'raw') {
    return <JsonPreview value={portRawPreview(port)} />;
  }

  return <DetailList lines={portBannerLines(port, latencyOf(port))} />;
}

function SelectionBreakdown({ columns, rows }: { columns: ResultColumn[]; rows: ResultRow[] }) {
  const lines = selectionBreakdownLines(rows, columns);
  if (lines.length === 0) return null;

  return (
    <div className="selection-breakdown">
      <span className="selection-breakdown-title">Selection Breakdown</span>
      <DetailList lines={lines} />
    </div>
  );
}

export function DetailPane({
  activeTab,
  columns,
  selectedRow,
  selectedRows,
  onContentContextMenu,
  onSetDetailTab,
}: DetailPaneProps) {
  const selectedCount = selectedRows.length;
  const tabSet = detailTabsFor(selectedRow, selectedCount);
  const activeDetail = tabSet.includes(activeTab.detailTab) ? activeTab.detailTab : tabSet[0];
  const [height, setHeight] = useState(184);
  const [mode, setMode] = useState<'normal' | 'collapsed' | 'expanded'>('normal');
  const flexBasis = mode === 'collapsed' ? 35 : mode === 'expanded' ? 'min(62vh, 560px)' : height;

  return (
    <div
      className={`detail-pane ${mode}`}
      data-testid="detail-pane"
      style={{ flexBasis }}
    >
      <div
        className="detail-resize-handle"
        role="separator"
        aria-label="Resize details pane"
        onPointerDown={(event) => startDetailResize(event, setHeight, setMode)}
      />
      <div className="detail-tabs">
        {tabSet.map((tab) => (
          <button className={activeDetail === tab ? 'active' : ''} key={tab} onClick={() => onSetDetailTab(tab)}>
            {tab}
          </button>
        ))}
        {selectedCount > 1 && (
          <span className="detail-context">
            {selectedCount} selected
          </span>
        )}
        {selectedCount <= 1 && selectedRow?.port && (
          <span className="detail-context">
            port {selectedRow.port.port} - {selectedRow.port.service ?? 'tcp'}
          </span>
        )}
        <div className="detail-actions">
          <button
            aria-label={mode === 'expanded' ? 'Restore Details Size' : 'Maximize Details Pane'}
            data-tooltip={mode === 'expanded' ? 'Restore Details Size' : 'Maximize Details Pane'}
            onClick={() => setMode(mode === 'expanded' ? 'normal' : 'expanded')}
          >
            <Square size={12} />
          </button>
          <button
            aria-label={mode === 'collapsed' ? 'Open Details Pane' : 'Collapse Details Pane'}
            data-tooltip={mode === 'collapsed' ? 'Open Details Pane' : 'Collapse Details Pane'}
            onClick={() => setMode(mode === 'collapsed' ? 'normal' : 'collapsed')}
          >
            {mode === 'collapsed' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {mode !== 'collapsed' && (
        <div
          className="detail-body"
          tabIndex={0}
          onContextMenu={onContentContextMenu}
          onKeyDown={selectDetailBodyOnShortcut}
          onMouseDown={(event) => {
            event.currentTarget.focus({ preventScroll: true });
          }}
        >
          {!selectedRow && <span className="muted">No row selected.</span>}
          {selectedCount > 1 && activeDetail === 'selection' && (
            <>
              <DetailList lines={selectionSummaryLines(selectedRows, columns)} />
              <SelectionBreakdown columns={columns} rows={selectedRows} />
            </>
          )}
          {selectedCount > 1 && activeDetail === 'raw' && <JsonPreview value={selectedRowsRawPreview(selectedRows)} />}
          {selectedCount <= 1 && selectedRow?.port && <PortDetail detailTab={activeDetail} row={selectedRow} />}
          {selectedCount <= 1 && selectedRow && !selectedRow.port && activeDetail === 'raw' && (
            <JsonPreview value={JSON.stringify(selectedRow.raw, null, 2)} />
          )}
          {selectedCount <= 1 && selectedRow && !selectedRow.port && activeDetail === 'details' && (
            <div className="detail-list">
              {Object.entries(selectedRow.data).map(([key, value]) => (
                <div className="detail-line" key={key}>
                  <span>{key}</span>
                  <code>{renderValue(value)}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function selectionBreakdownLines(rows: ResultRow[], columns: ResultColumn[]): Array<{ label: string; value: string; muted?: boolean }> {
  if (rows.length === 0) return [];

  if (rows.some((row) => row.port)) {
    const ports = rows
      .map((row) => row.port?.port)
      .filter((port): port is number => typeof port === 'number')
      .map(String);
    const services = topCounts(rows.map((row) => row.port?.service ?? 'tcp').filter(isUsefulValue));
    return [
      { label: 'Ports', value: formatSample(ports, 14), muted: ports.length === 0 },
      { label: 'Services', value: services || '-', muted: !services },
    ];
  }

  const valuesFor = (key: string) => rows.map((row) => renderValue(row.data[key])).filter(isUsefulValue);
  const ipValues = valuesFor('ip');
  const vendorValues = valuesFor('vendor');
  const interfaceValues = valuesFor('interface');
  const recordTypes = valuesFor('record_type');
  const addressValues = valuesFor('addresses');

  if (ipValues.length > 0 || vendorValues.length > 0 || interfaceValues.length > 0) {
    const knownVendors = vendorValues.length;
    const unknownVendors = Math.max(0, rows.length - knownVendors);
    return [
      {
        label: 'Vendor Coverage',
        value: `${knownVendors} known, ${unknownVendors} unknown`,
        muted: knownVendors === 0,
      },
      { label: 'Top Vendors', value: topCounts(vendorValues) || '-', muted: vendorValues.length === 0 },
      { label: 'Interfaces', value: topCounts(interfaceValues) || '-', muted: interfaceValues.length === 0 },
      { label: 'IP Sample', value: formatSample(ipValues, 10), muted: ipValues.length === 0 },
    ];
  }

  if (recordTypes.length > 0) {
    return [
      { label: 'Record Types', value: topCounts(recordTypes) || '-', muted: recordTypes.length === 0 },
      { label: 'Value Sample', value: formatSample(valuesFor('value'), 6), muted: valuesFor('value').length === 0 },
    ];
  }

  if (addressValues.length > 0) {
    return [
      { label: 'Interfaces', value: formatSample(valuesFor('interface'), 8), muted: valuesFor('interface').length === 0 },
      { label: 'Addresses', value: formatSample(addressValues, 4), muted: addressValues.length === 0 },
    ];
  }

  const sampleColumn = columns.find((column) => rows.some((row) => isUsefulValue(renderValue(row.data[column.key]))));
  if (!sampleColumn) return [];
  return [
    {
      label: `${sampleColumn.label} Sample`,
      value: formatSample(valuesFor(sampleColumn.key), 8),
    },
  ];
}

function topCounts(values: string[], limit = 4): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value}: ${count}`)
    .join(', ');
}

function formatSample(values: string[], limit: number): string {
  if (values.length === 0) return '-';
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length <= limit) return uniqueValues.join(', ');
  return `${uniqueValues.slice(0, limit).join(', ')} +${uniqueValues.length - limit} more`;
}

function isUsefulValue(value: string | undefined): value is string {
  return Boolean(value && value.trim() && value !== '-');
}

function selectDetailBodyOnShortcut(event: KeyboardEvent<HTMLDivElement>) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
  event.preventDefault();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(event.currentTarget);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function startDetailResize(
  event: PointerEvent<HTMLDivElement>,
  setHeight: (height: number) => void,
  setMode: (mode: 'normal' | 'collapsed' | 'expanded') => void,
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
