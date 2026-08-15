import type { PortResult } from '../../types/netscli';

export function statusOf(port: PortResult): string {
  return port.status ?? (port.open ? 'open' : 'closed');
}

/**
 * How a port's latency cell reads, everywhere.
 *
 * The table and the detail pane used to disagree (M-7): this returned `''`
 * for a closed port while `latencyOfPort` returned `refused`, so the same
 * scan showed a blank cell in one place and a reason in the other -- and both
 * were used inside the detail pane itself. `latencyOfPort` now delegates
 * here, so there is one answer.
 */
export function latencyOf(port: PortResult): string {
  if (port.latency_ms != null) return `${port.latency_ms} ms`;
  switch (statusOf(port)) {
    case 'filtered':
      return 'timeout';
    case 'closed':
      return 'refused';
    default:
      return '-';
  }
}
