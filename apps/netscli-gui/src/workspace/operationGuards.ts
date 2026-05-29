import type { WorkspaceTab } from '../tools/types';

export interface OperationGuard {
  title: string;
  message: string;
  confirmLabel: string;
}

const PUBLIC_SCAN_CONFIRM_HOSTS = 256;
const LARGE_PRIVATE_CONFIRM_HOSTS = 4096;
const LARGE_SWEEP_CONFIRM_PROBES = 8192;

export function guardForOperation(tab: WorkspaceTab | undefined): OperationGuard | null {
  if (!tab) return null;

  if (tab.kind !== 'discover' && tab.kind !== 'sweep') return null;

  const subnet = tab.form.subnet?.trim();
  const parsed = parseIpv4Cidr(subnet);
  if (!parsed) return null;

  const hostCount = usableHostCount(parsed.prefix);
  const publicRange = !isPrivateIpv4(parsed.octets);
  const ports = tab.kind === 'sweep' ? countPorts(tab.form.ports) : 0;
  const probeCount = tab.kind === 'sweep' ? hostCount * Math.max(ports, 1) : hostCount;

  if (publicRange && hostCount > PUBLIC_SCAN_CONFIRM_HOSTS) {
    return {
      title: 'Confirm Public Range',
      message: `${tab.kind === 'sweep' ? 'Sweeping' : 'Discovering'} ${subnet} touches about ${hostCount.toLocaleString()} public addresses. Continue only if you own or have permission to test this range.`,
      confirmLabel: `Run ${tab.kind}`,
    };
  }

  if (hostCount > LARGE_PRIVATE_CONFIRM_HOSTS || probeCount > LARGE_SWEEP_CONFIRM_PROBES) {
    return {
      title: 'Confirm Large Operation',
      message: `${tab.kind === 'sweep' ? 'Sweeping' : 'Discovering'} ${subnet} may send about ${probeCount.toLocaleString()} probes. This can be noisy on fragile networks.`,
      confirmLabel: `Run ${tab.kind}`,
    };
  }

  return null;
}

function parseIpv4Cidr(value: string | undefined): { octets: number[]; prefix: number } | null {
  const match = value?.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { octets, prefix };
}

function usableHostCount(prefix: number): number {
  if (prefix >= 31) return 1;
  return Math.max(1, 2 ** (32 - prefix) - 2);
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function countPorts(value: string | undefined): number {
  if (!value?.trim()) return 0;

  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((count, part) => {
      const range = part.match(/^(\d+)-(\d+)$/);
      if (!range) return count + 1;
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return count + 1;
      return count + end - start + 1;
    }, 0);
}
