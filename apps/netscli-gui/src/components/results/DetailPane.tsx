import { ChevronDown, ChevronUp, Square } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import {
  detailTabsFor,
  detailLinesForRow,
  inspectOverviewLines,
  inspectPortsLines,
  latencyOf,
  portBannerLines,
  portHeaderLines,
  portRawPreview,
  portTlsLines,
  selectedRowsRawPreview,
  selectionSummaryLines,
} from '../../tools/presentation';
import type { DetailTab, ResultColumn, ResultRow, WorkspaceTab } from '../../tools/types';
import { DetailList } from './DetailList';
import {
  handleDetailResizeKeyDown,
  selectDetailBodyOnShortcut,
  startDetailResize,
  updateDetailOverflowState,
  type DetailPaneMode,
} from './detailPaneResize';
import { JsonPreview } from './JsonPreview';
import { SelectionBreakdown } from './SelectionBreakdown';

interface DetailPaneProps {
  activeTab: WorkspaceTab;
  columns: ResultColumn[];
  selectedRow: ResultRow | undefined;
  selectedRows: ResultRow[];
  onContentContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onSetDetailTab: (tab: DetailTab) => void;
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

export function DetailPane({
  activeTab,
  columns,
  selectedRow,
  selectedRows,
  onContentContextMenu,
  onSetDetailTab,
}: DetailPaneProps) {
  const selectedCount = selectedRows.length;
  const inspectResult = activeTab.result?.kind === 'inspect' ? activeTab.result.data : null;
  const tabSet = inspectResult && selectedCount <= 1
    ? (['overview', 'ports', 'raw'] as DetailTab[])
    : detailTabsFor(selectedRow, selectedCount);
  const activeDetail = tabSet.includes(activeTab.detailTab) ? activeTab.detailTab : tabSet[0];
  const [height, setHeight] = useState(184);
  const [mode, setMode] = useState<DetailPaneMode>('normal');
  const detailBodyRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({
    top: false,
    right: false,
    bottom: false,
    left: false,
    vertical: false,
    horizontal: false,
  });
  const flexBasis = mode === 'collapsed' ? 35 : mode === 'expanded' ? 'min(62vh, 560px)' : height;

  useEffect(() => {
    updateDetailOverflowState(detailBodyRef.current, setOverflow);
  }, [activeDetail, activeTab.result, mode, selectedCount, selectedRow?.id]);

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
        aria-orientation="horizontal"
        aria-valuemax={560}
        aria-valuemin={35}
        aria-valuenow={mode === 'collapsed' ? 35 : mode === 'expanded' ? 560 : height}
        tabIndex={0}
        onKeyDown={(event) => handleDetailResizeKeyDown(event, height, setHeight, setMode)}
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
        {selectedCount <= 1 && selectedRow?.port && !inspectResult && (
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
            <Square size={mode === 'expanded' ? 10 : 12} />
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
          className={[
            'detail-body',
            overflow.vertical ? 'has-vertical-overflow' : '',
            overflow.horizontal ? 'has-horizontal-overflow' : '',
            overflow.top ? 'has-top-overflow' : '',
            overflow.right ? 'has-right-overflow' : '',
            overflow.bottom ? 'has-bottom-overflow' : '',
            overflow.left ? 'has-left-overflow' : '',
          ].filter(Boolean).join(' ')}
          ref={detailBodyRef}
          tabIndex={0}
          onContextMenu={onContentContextMenu}
          onKeyDown={selectDetailBodyOnShortcut}
          onScroll={() => updateDetailOverflowState(detailBodyRef.current, setOverflow)}
          onMouseDown={(event) => {
            event.currentTarget.focus({ preventScroll: true });
          }}
        >
          {!selectedRow && !inspectResult && <span className="muted">No row selected.</span>}
          {inspectResult && selectedCount <= 1 && activeDetail === 'overview' && (
            <DetailList lines={inspectOverviewLines(inspectResult)} />
          )}
          {inspectResult && selectedCount <= 1 && activeDetail === 'ports' && (
            <DetailList lines={inspectPortsLines(inspectResult, selectedRow)} />
          )}
          {inspectResult && selectedCount <= 1 && activeDetail === 'raw' && (
            <JsonPreview value={JSON.stringify(inspectResult, null, 2)} />
          )}
          {selectedCount > 1 && activeDetail === 'selection' && (
            <>
              <DetailList lines={selectionSummaryLines(selectedRows, columns)} />
              <SelectionBreakdown columns={columns} rows={selectedRows} />
            </>
          )}
          {selectedCount > 1 && activeDetail === 'raw' && <JsonPreview value={selectedRowsRawPreview(selectedRows)} />}
          {selectedCount <= 1 && !inspectResult && selectedRow?.port && <PortDetail detailTab={activeDetail} row={selectedRow} />}
          {selectedCount <= 1 && !inspectResult && selectedRow && !selectedRow.port && activeDetail === 'raw' && (
            <JsonPreview value={JSON.stringify(selectedRow.raw, null, 2)} />
          )}
          {selectedCount <= 1 && !inspectResult && selectedRow && !selectedRow.port && activeDetail === 'details' && (
            <DetailList lines={detailLinesForRow(selectedRow)} />
          )}
        </div>
      )}
    </div>
  );
}
