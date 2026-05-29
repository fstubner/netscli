import type { PortResult } from '../../types/netscli';

export function statusOf(port: PortResult): string {
  return port.status ?? (port.open ? 'open' : 'closed');
}

export function latencyOf(port: PortResult): string {
  if (port.latency_ms != null) return `${port.latency_ms} ms`;
  return statusOf(port) === 'filtered' ? 'timeout' : '';
}
