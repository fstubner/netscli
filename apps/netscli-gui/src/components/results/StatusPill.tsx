import { renderValue } from '../../tools/presentation';

interface StatusPillProps {
  value: unknown;
}

export function StatusPill({ value }: StatusPillProps) {
  return (
    <span className={`status-pill status-${String(value || '').toLowerCase()}`}>
      <span className="status-dot" />
      {renderValue(value)}
    </span>
  );
}
