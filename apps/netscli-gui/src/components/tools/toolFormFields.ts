import type { ToolField, WorkspaceTab } from '../../tools/types';
import type { InterfaceInfo } from '../../types/netscli';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export function fieldsForTab(tab: WorkspaceTab, fields: ToolField[]): ToolField[] {
  if (tab.kind !== 'pcap') return fields;
  const mode = tab.form.mode || 'Capture';
  if (mode === 'Open File') {
    return fields.filter((field) => field.key === 'mode' || field.key === 'max_packets');
  }
  return fields;
}

export function selectOptionsForField(
  tab: WorkspaceTab,
  fieldKey: string,
  staticOptions: string[] | undefined,
  interfaces: InterfaceInfo[],
): SelectOption[] {
  if (tab.kind === 'pcap' && fieldKey === 'interface') {
    return pcapInterfaceOptions(interfaces, tab.form[fieldKey]);
  }

  return (staticOptions ?? []).map((option) => ({ value: option, label: option }));
}

function pcapInterfaceOptions(interfaces: InterfaceInfo[], currentValue: string | undefined): SelectOption[] {
  const sorted = [...interfaces].sort((a, b) => interfaceScore(b) - interfaceScore(a));
  const options = sorted.map((iface) => ({
    value: iface.name,
    label: iface.name,
    description: interfaceDescription(iface),
  }));

  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.unshift({
      value: currentValue,
      label: currentValue,
      description: 'Custom interface',
    });
  }

  return options;
}

function interfaceScore(iface: InterfaceInfo): number {
  const upScore = iface.is_up ? 100 : 0;
  const physicalScore = iface.is_loopback || isVirtualInterfaceName(iface.name) ? 0 : 50;
  const addressScore = iface.ips.length > 0 ? 10 : 0;
  return upScore + physicalScore + addressScore;
}

function interfaceDescription(iface: InterfaceInfo): string {
  const address = preferredInterfaceAddress(iface.ips);
  const state = iface.is_up ? 'Up' : 'Down';
  const loopback = iface.is_loopback ? ' - Loopback' : '';
  return address ? `${address} - ${state}${loopback}` : `${state}${loopback}`;
}

function preferredInterfaceAddress(ips: string[]): string | null {
  return (
    ips.find((ip) => !ip.startsWith('169.254.') && !ip.startsWith('fe80:')) ??
    ips[0] ??
    null
  );
}

function isVirtualInterfaceName(name: string): boolean {
  return /tailscale|loopback|bluetooth|vethernet|default switch|wsl|docker|hyper-v|vmware|virtualbox|vmnet|npcap|pseudo-interface/i.test(
    name,
  );
}
