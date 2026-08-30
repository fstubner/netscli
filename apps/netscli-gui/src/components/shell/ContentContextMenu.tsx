import {
  Activity,
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useRovingFocus } from '../primitives/focus';
import { computePointPopoverPosition, useOverlayDismiss } from '../primitives/overlay';
import type { ResultCellContext } from '../../tools/types';

interface ContextAction {
  disabled?: boolean;
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Marks an action that destroys something. Renders the icon in red, the
   *  same signal the menu bar's `danger` variant uses -- this menu offers
   *  Clear Current Results too, and the two should not disagree about how a
   *  destructive item looks. */
  variant?: 'danger';
}

interface ContentContextMenuProps {
  canClear: boolean;
  canUseSelection: boolean;
  cell?: ResultCellContext;
  captureFilePath?: string;
  x: number;
  y: number;
  onClearResults: () => void;
  onClose: () => void;
  onCopyCell: (cell: ResultCellContext) => void;
  onCopyDetails: () => void;
  onCopyRaw: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onInspectHost: (host: string) => void;
  onOpenCaptureFile: (path: string) => void;
  onRevealCaptureFile: (path: string) => void;
  onScanHost: (host: string) => void;
}

export function ContentContextMenu({
  canClear,
  canUseSelection,
  cell,
  captureFilePath,
  x,
  y,
  onClearResults,
  onClose,
  onCopyCell,
  onCopyDetails,
  onCopyRaw,
  onExportCsv,
  onExportJson,
  onInspectHost,
  onOpenCaptureFile,
  onRevealCaptureFile,
  onScanHost,
}: ContentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const host = hostForContext(cell);
  const actions: ContextAction[] = [
    ...(cell
      ? [
          {
            label: `Copy ${cell.label}`,
            Icon: Copy,
            onClick: () => onCopyCell(cell),
          },
        ]
      : []),
    ...(host
      ? [
          { label: `Inspect ${host}`, Icon: Activity, onClick: () => onInspectHost(host) },
          { label: `Scan ${host}`, Icon: Search, onClick: () => onScanHost(host) },
        ]
      : []),
    ...(captureFilePath
      ? [
          { label: 'Open Capture File', Icon: Download, onClick: () => onOpenCaptureFile(captureFilePath) },
          { label: 'Open Containing Folder', Icon: FolderOpen, onClick: () => onRevealCaptureFile(captureFilePath) },
        ]
      : []),
    { label: 'Copy Selected Details', Icon: ClipboardList, onClick: onCopyDetails, disabled: !canUseSelection },
    { label: 'Copy Selected Raw', Icon: Copy, onClick: onCopyRaw, disabled: !canUseSelection },
    { label: 'Export Selected JSON', Icon: Download, onClick: onExportJson, disabled: !canUseSelection },
    { label: 'Export Selected CSV', Icon: FileSpreadsheet, onClick: onExportCsv, disabled: !canUseSelection },
    { label: 'Clear Current Results', Icon: Trash2, onClick: onClearResults, disabled: !canClear, variant: 'danger' },
  ];
  const estimatedHeight = 190 + (cell ? 34 : 0) + (host ? 68 : 0) + (captureFilePath ? 68 : 0);
  const position = useMemo(
    () => computePointPopoverPosition(x, y, 290, estimatedHeight, window.innerWidth, window.innerHeight),
    [estimatedHeight, x, y],
  );
  const onKeyDown = useRovingFocus({
    containerRef: menuRef,
    enabled: true,
    itemSelector: 'button:not(:disabled)',
    onClose,
  });
  useOverlayDismiss({
    enabled: true,
    onClose,
    refs: [menuRef],
  });

  return (
    <div
      className="content-context-menu"
      data-testid="content-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: position.left, maxHeight: position.maxHeight, top: position.top }}
      tabIndex={-1}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {actions.map((action) => (
        <button
          className={action.variant === 'danger' ? 'danger' : undefined}
          disabled={action.disabled}
          key={action.label}
          role="menuitem"
          type="button"
          onClick={() => {
            action.onClick();
            onClose();
          }}
        >
          <action.Icon size={14} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function hostForContext(cell: ResultCellContext | undefined): string | null {
  const data = cell?.row?.data;
  if (!data) return null;
  const value = data.ip ?? data.host;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text && text !== '-' ? text : null;
}
