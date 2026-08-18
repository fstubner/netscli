import type { InspectResult, PortResult } from '../../types/netscli';

/**
 * Which ports an inspect actually checked, everywhere.
 *
 * Three call sites had drifted into two different answers: the row builder
 * used `ports?.length ? ports : open_ports`, while the column set and the
 * status-bar summary used `ports ?? open_ports`. A backend returning
 * `ports: []` alongside a non-empty `open_ports` therefore rendered rows
 * from `open_ports` while the columns were built from an empty list, so
 * every cell came out blank.
 *
 * The length check is the right one to keep: `ports` is optional for older
 * backends, and an empty list carries no more information than a missing
 * one.
 */
export function inspectPorts(result: InspectResult): PortResult[] {
  return result.ports?.length ? result.ports : result.open_ports;
}

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
