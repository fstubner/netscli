import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onCancel}>
      <section
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="confirm-dialog-header">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <AlertTriangle size={17} />
          </span>
          <div>
            <h2 id="confirm-title">{title}</h2>
            <p>{message}</p>
          </div>
          <button className="dialog-close" aria-label="Cancel" type="button" onClick={onCancel}>
            <X size={15} />
          </button>
        </header>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
