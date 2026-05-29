import type { DefaultInterfaceInfo, InterfaceInfo } from '../types/netscli';
import type { ToolKind, WorkspaceTab } from '../tools/types';

export function shouldAutoRun(kind: ToolKind): boolean {
  return kind === 'interfaces' || kind === 'arp';
}

export function applyContextDefaults(
  tab: WorkspaceTab,
  defaultInterface: DefaultInterfaceInfo | null,
  trafficInterfaceName: string | null,
  interfaces: InterfaceInfo[] = [],
): WorkspaceTab {
  const form = { ...tab.form };
  let changed = false;

  const patchIfBlank = (key: string, value: string | null | undefined) => {
    if (!value || form[key]?.trim()) return;
    form[key] = value;
    changed = true;
  };

  switch (tab.kind) {
    case 'discover':
    case 'sweep':
      patchIfBlank('subnet', subnetFromInterfaces(defaultInterface, interfaces));
      break;
    case 'pcap':
      patchIfBlank('interface', preferredCaptureInterface(trafficInterfaceName, defaultInterface, interfaces));
      break;
    default:
      break;
  }

  return changed ? { ...tab, form } : tab;
}

export function subnetFromInterfaces(
  defaultInterface: DefaultInterfaceInfo | null,
  interfaces: InterfaceInfo[],
): string | null {
  const pool: Array<{
    name: string;
    ips: string[];
    isUp: boolean;
    isLoopback: boolean;
    isDefault: boolean;
  }> = interfaces.map((iface) => ({
    name: iface.name,
    ips: iface.ips,
    isUp: iface.is_up,
    isLoopback: iface.is_loopback,
    isDefault: iface.name === defaultInterface?.name,
  }));

  if (defaultInterface && !pool.some((iface) => iface.name === defaultInterface.name)) {
    pool.push({
      name: defaultInterface.name,
      ips: defaultInterface.ips,
      isUp: defaultInterface.is_up,
      isLoopback: false,
      isDefault: true,
    });
  }

  const physicalCandidates = cidrCandidates(pool, false);
  if (physicalCandidates.length > 0) return physicalCandidates[0].networkCidr;

  const fallbackCandidates = cidrCandidates(pool, true);
  if (fallbackCandidates.length > 0) return fallbackCandidates[0].networkCidr;

  return '192.168.1.0/24';
}

export function preferredCaptureInterface(
  trafficInterfaceName: string | null,
  defaultInterface: DefaultInterfaceInfo | null,
  interfaces: InterfaceInfo[],
): string | null {
  const saved = trafficInterfaceName
    ? interfaces.find(
        (iface) =>
          iface.name === trafficInterfaceName &&
          isUsableCaptureInterface(iface) &&
          !isVirtualInterfaceName(iface.name),
      )
    : null;
  if (saved) return saved.name;

  const defaultCapture = interfaces.find(
    (iface) =>
      iface.name === defaultInterface?.name &&
      isUsableCaptureInterface(iface) &&
      !isVirtualInterfaceName(iface.name),
  );
  if (defaultCapture) return defaultCapture.name;

  return (
    interfaces.find((iface) => isUsableCaptureInterface(iface) && !isVirtualInterfaceName(iface.name))?.name ??
    interfaces.find(isUsableCaptureInterface)?.name ??
    defaultInterface?.name ??
    null
  );
}

interface ParsedCidr {
  networkCidr: string;
  prefix: number;
  isDefault: boolean;
}

function parsePrivateLanCidr(cidr: string): ParsedCidr | null {
  const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return null;

  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 30) return null;
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  if (!isPrivateLanAddress(octets)) return null;

  const host = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = host & mask;
  const networkAddress = [
    (network >>> 24) & 255,
    (network >>> 16) & 255,
    (network >>> 8) & 255,
    network & 255,
  ].join('.');

  return { networkCidr: `${networkAddress}/${prefix}`, prefix, isDefault: false };
}

function isPrivateLanAddress(octets: number[]): boolean {
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function scoreCidr(cidr: ParsedCidr): number {
  const defaultScore = cidr.isDefault ? 100 : 0;
  const rangeScore = cidr.networkCidr.startsWith('192.168.')
    ? 40
    : cidr.networkCidr.startsWith('10.')
      ? 25
      : 10;
  const prefixScore = cidr.prefix <= 24 ? 24 - cidr.prefix : 24 - cidr.prefix - 20;
  return defaultScore + rangeScore + prefixScore;
}

function cidrCandidates(
  pool: Array<{
    name: string;
    ips: string[];
    isUp: boolean;
    isLoopback: boolean;
    isDefault: boolean;
  }>,
  allowVirtual: boolean,
): ParsedCidr[] {
  return pool
    .filter(
      (iface) =>
        iface.isUp &&
        !iface.isLoopback &&
        (allowVirtual || !isVirtualInterfaceName(iface.name)),
    )
    .flatMap((iface) =>
      iface.ips
        .map((cidr) => parsePrivateLanCidr(cidr))
        .filter((cidr): cidr is ParsedCidr => cidr !== null)
        .map((cidr) => ({ ...cidr, isDefault: iface.isDefault })),
    )
    .sort((a, b) => scoreCidr(b) - scoreCidr(a));
}

function isUsableCaptureInterface(iface: InterfaceInfo): boolean {
  return iface.is_up && !iface.is_loopback && iface.name.trim().length > 0;
}

function isVirtualInterfaceName(name: string): boolean {
  return /tailscale|loopback|bluetooth|vethernet|default switch|wsl|docker|hyper-v|vmware|virtualbox|vmnet|npcap|pseudo-interface/i.test(
    name,
  );
}
