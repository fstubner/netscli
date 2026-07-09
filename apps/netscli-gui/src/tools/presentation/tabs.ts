import { DEFAULT_PORTS } from '../registry';
import type { WorkspaceTab } from '../types';

export interface TabIdentity {
  label: string;
  identifier: string;
}

const TAB_LABELS: Record<WorkspaceTab['kind'], string> = {
  scan: 'Scan',
  ping: 'Ping',
  trace: 'Trace',
  discover: 'Discover',
  dns: 'DNS',
  reverse: 'Reverse DNS',
  inspect: 'Inspect',
  sweep: 'Sweep',
  mdns: 'mDNS',
  interfaces: 'Interfaces',
  arp: 'ARP',
  pcap: 'Packet Capture',
};

export function tabIdentity(tab: WorkspaceTab): TabIdentity {
  const form = tab.form;
  const label = TAB_LABELS[tab.kind];

  switch (tab.kind) {
    case 'scan':
      return {
        label,
        identifier: joinParts(clean(form.host), customPorts(form.ports)),
      };
    case 'ping':
      return { label, identifier: clean(form.host) || 'New' };
    case 'trace':
      return { label, identifier: clean(form.host) || 'New' };
    case 'discover':
      return { label, identifier: clean(form.subnet) || 'Default subnet' };
    case 'dns':
      return {
        label,
        identifier: clean(form.host) ? joinParts(clean(form.host), dnsRecordLabel(form.record)) : 'New',
      };
    case 'reverse':
      return { label, identifier: clean(form.ip) || 'New' };
    case 'inspect':
      return {
        label,
        identifier: clean(form.host) ? joinParts(clean(form.host), customPorts(form.ports)) : 'New',
      };
    case 'sweep':
      return {
        label,
        identifier: joinParts(clean(form.subnet), customPorts(form.ports)),
      };
    case 'mdns':
      return {
        label,
        identifier: clean(form.service_types) || '',
      };
    case 'interfaces':
      return { label, identifier: '' };
    case 'arp':
      return { label, identifier: '' };
    case 'pcap':
      return {
        label,
        identifier:
          form.mode === 'Open File'
            ? 'Open File'
            : clean(form.interface)
              ? joinParts(clean(form.interface), clean(form.filter))
              : 'New',
      };
  }
}

function clean(value: string | undefined): string {
  return value?.trim() ?? '';
}

function customPorts(value: string | undefined): string {
  const ports = clean(value);
  if (!ports || ports === DEFAULT_PORTS) {
    return '';
  }
  return ports;
}

function dnsRecordLabel(value: string | undefined): string {
  const record = clean(value);
  return record && record !== 'ALL' ? record : '';
}

function joinParts(primary: string, secondary: string): string {
  if (primary && secondary) {
    return `${primary} - ${secondary}`;
  }
  return primary || secondary || 'New';
}
