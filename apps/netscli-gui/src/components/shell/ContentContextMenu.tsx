import {
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

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
  const actions: ContextAction[] = [
    { label: 'Copy Selected Details', Icon: ClipboardList, onClick: onCopyDetails, disabled: !canUseSelection },
    { label: 'Copy Selected Raw', Icon: Copy, onClick: onCopyRaw, disabled: !canUseSelection },
    { label: 'Export Selected JSON', Icon: Download, onClick: onExportJson, disabled: !canUseSelection },
    { label: 'Export Selected CSV', Icon: FileSpreadsheet, onClick: onExportCsv, disabled: !canUseSelection },
    { label: 'Clear Current Results', Icon: Trash2, onClick: onClearResults, disabled: !canClear },
  ];

  return (
    <div
      className="content-context-menu"
      data-testid="content-context-menu"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <button
          disabled={action.disabled}
          key={action.label}
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
