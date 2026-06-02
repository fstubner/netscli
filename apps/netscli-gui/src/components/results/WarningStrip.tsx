import { X } from 'lucide-react';

export function warningMessageFor(warnings: string[] | undefined): string | null {
  if (!warnings || warnings.length === 0) return null;
  if (warnings.length === 1) return warnings[0];
  return `${warnings.length} lookup warnings. ${warnings[0]}`;
}

interface WarningStripProps {
  message: string;
  onDismiss: () => void;
}

export function WarningStrip({ message, onDismiss }: WarningStripProps) {
  return (
    <div className="warning-strip" role="status">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss warning" data-testid="dismiss-warning" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}

