import { renderValue } from '../../tools/presentation';

interface StatusPillProps {
  value: unknown;
}

export function StatusPill({ value }: StatusPillProps) {
  const label = statusExplanation(value);
  return (
    <span
      className={`status-pill status-${String(value || '').toLowerCase()}`}
      data-tooltip={label}
    >
      <span className="status-dot" />
      {renderValue(value)}
    </span>
  );
}

function statusExplanation(value: unknown): string {
  switch (String(value || '').toLowerCase()) {
    case 'filtered':
      return 'Filtered: timed out or blocked before connect.';
    case 'closed':
      return 'Closed: connection refused by the host.';
    case 'open':
      return 'Open: TCP connection succeeded.';
    case 'error':
      return 'Error: probe failed before classification completed.';
    case 'up':
      return 'Interface or host is reachable/up.';
    case 'down':
      return 'Interface or host is unavailable/down.';
    default:
      return renderValue(value);
  }
}
