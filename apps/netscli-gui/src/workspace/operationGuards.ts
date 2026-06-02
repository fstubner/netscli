import type { WorkspaceTab } from '../tools/types';

export interface OperationGuard {
  title: string;
  message: string;
  confirmLabel: string;
}

const LARGE_PRIVATE_CONFIRM_HOSTS = 4096;
const LARGE_SWEEP_CONFIRM_PROBES = 8192;
const LARGE_PORT_CONFIRM_PROBES = 1024;

export function guardForOperation(tab: WorkspaceTab | undefined): OperationGuard | null {
  if (!tab) return null;

  if (tab.kind === 'scan' || tab.kind === 'inspect') {
    const ports = countPorts(tab.form.ports);
    if (ports > LARGE_PORT_CONFIRM_PROBES) {
      return {
        title: 'Confirm Large Port Set',
        message: `${tab.kind === 'scan' ? 'Scanning' : 'Inspecting'} ${tab.form.host || 'this host'} checks ${ports.toLocaleString()} ports. Continue only if this is intentional.`,
        confirmLabel: `Run ${tab.kind}`,
      };
    }
    return null;
  }

  if (tab.kind !== 'discover' && tab.kind !== 'sweep') return null;

  const subnet = tab.form.subnet?.trim();
  const parsed = parseIpv4Cidr(subnet);
  if (!parsed) return null;

  const hostCount = usableHostCount(parsed.prefix);
  const publicRange = isPublicIpv4(parsed.octets);
  const ports = tab.kind === 'sweep' ? countPorts(tab.form.ports, 5) : 0;
  const probeCount = tab.kind === 'sweep' ? hostCount * Math.max(ports, 1) : hostCount;

  if (publicRange && hostCount > 1) {
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

function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  if (a === 127 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return false;
  if (a === 0 || a >= 224) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function countPorts(value: string | undefined, fallback = 0): number {
  if (!value?.trim()) return fallback;

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
