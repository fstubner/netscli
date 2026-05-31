import {
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useRovingFocus } from '../primitives/focus';
import { computePointPopoverPosition, useOverlayDismiss } from '../primitives/overlay';

interface ContextAction {
  disabled?: boolean;
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
}

interface ContentContextMenuProps {
  canClear: boolean;
  canUseSelection: boolean;
  x: number;
  y: number;
  onClearResults: () => void;
  onClose: () => void;
  onCopyDetails: () => void;
  onCopyRaw: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
}

export function ContentContextMenu({
  canClear,
  canUseSelection,
  x,
  y,
  onClearResults,
  onClose,
  onCopyDetails,
  onCopyRaw,
  onExportCsv,
  onExportJson,
}: ContentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actions: ContextAction[] = [
    { label: 'Copy Selected Details', Icon: ClipboardList, onClick: onCopyDetails, disabled: !canUseSelection },
    { label: 'Copy Selected Raw', Icon: Copy, onClick: onCopyRaw, disabled: !canUseSelection },
    { label: 'Export Selected JSON', Icon: Download, onClick: onExportJson, disabled: !canUseSelection },
    { label: 'Export Selected CSV', Icon: FileSpreadsheet, onClick: onExportCsv, disabled: !canUseSelection },
    { label: 'Clear Current Results', Icon: Trash2, onClick: onClearResults, disabled: !canClear },
  ];
  const position = useMemo(
    () => computePointPopoverPosition(x, y, 290, 190, window.innerWidth, window.innerHeight),
    [x, y],
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
