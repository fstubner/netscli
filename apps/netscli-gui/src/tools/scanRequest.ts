import { DEFAULT_PORTS } from './registry';
import type { ToolKind } from './types';

/** The UDP ports the backend checks by default (`DEFAULT_UDP_PORTS` in the core). */
export const DEFAULT_UDP_PORTS = '53,123,137,1900,5353';

/**
 * What a Port Scan tab asks the backend for. Shared by execution and the
 * command preview so the two can't disagree, as they once did over which
 * ports an empty field meant (see presentation/commands.ts).
 */
export function scanRequest(form: Record<string, string | undefined>): { ports?: string; udp: boolean } {
  return { ports: form.ports?.trim() || undefined, udp: form.protocol === 'UDP' };
}

/**
 * Apply one form edit, keeping the Port Scan tab's port list in step with its
 * protocol: switching TCP to UDP while Ports still holds the TCP defaults
 * swaps in the UDP defaults, and back. Probing SSH and HTTP ports over UDP
 * would only read open|filtered, and a field that kept showing them while
 * the scan used something else would say one thing and do another. A list
 * the user typed is left alone.
 */
export function applyFormChange(
  kind: ToolKind,
  form: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const next = { ...form, [key]: value };
  if (kind !== 'scan' || key !== 'protocol') return next;
  const ports = form.ports?.trim();
  if (value === 'UDP' && ports === DEFAULT_PORTS) next.ports = DEFAULT_UDP_PORTS;
  if (value === 'TCP' && ports === DEFAULT_UDP_PORTS) next.ports = DEFAULT_PORTS;
  return next;
}
