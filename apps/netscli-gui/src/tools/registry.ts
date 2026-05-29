import {
  Activity,
  Database,
  Globe2,
  HardDrive,
  Network,
  Radio,
  Search,
} from 'lucide-react';

import type { ToolConfig, ToolKind, WorkspaceTab } from './types';

export const DEFAULT_PORTS = '22,80,443,8080,8443';

export const TOOL_KINDS: ToolKind[] = [
  'scan',
  'discover',
  'dns',
  'inspect',
  'sweep',
  'interfaces',
  'arp',
  'pcap',
];

export const SCAN_TOOL_KINDS: ToolKind[] = ['scan', 'discover', 'inspect', 'sweep'];

export const LOOKUP_TOOL_KINDS: ToolKind[] = ['dns', 'interfaces', 'arp', 'pcap'];

export const TOOL_CONFIG: Record<ToolKind, ToolConfig> = {
  scan: {
    label: 'Port Scan',
    shortLabel: 'scan',
    Icon: Search,
    action: 'Scan',
    fields: [
      { key: 'host', label: 'Host', placeholder: '127.0.0.1', required: true },
      { key: 'ports', label: 'Ports', placeholder: DEFAULT_PORTS },
    ],
  },
  discover: {
    label: 'Discover',
    shortLabel: 'discover',
    Icon: Network,
    action: 'Discover',
    fields: [{ key: 'subnet', label: 'Subnet', placeholder: '192.168.1.0/24' }],
  },
  dns: {
    label: 'DNS Lookup',
    shortLabel: 'dns',
    Icon: Globe2,
    action: 'Lookup',
    fields: [
      { key: 'host', label: 'Host', placeholder: 'netscli.com', required: true },
      {
        key: 'record',
        label: 'Record',
        type: 'select',
        compact: true,
        options: ['ALL', 'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SRV', 'PTR', 'SOA', 'CAA'],
      },
    ],
  },
  inspect: {
    label: 'Inspect',
    shortLabel: 'inspect',
    Icon: Activity,
    action: 'Inspect',
    fields: [
      { key: 'host', label: 'Host', placeholder: '127.0.0.1', required: true },
      { key: 'ports', label: 'Ports', placeholder: DEFAULT_PORTS },
    ],
  },
  sweep: {
    label: 'Sweep',
    shortLabel: 'sweep',
    Icon: Radio,
    action: 'Sweep',
    fields: [
      { key: 'subnet', label: 'Subnet', placeholder: '192.168.1.0/24' },
      { key: 'ports', label: 'Ports', placeholder: '22,80,443' },
    ],
  },
  interfaces: {
    label: 'Interfaces',
    shortLabel: 'interfaces',
    Icon: HardDrive,
    action: 'Refresh',
    fields: [],
  },
  arp: {
    label: 'ARP Table',
    shortLabel: 'arp',
    Icon: Database,
    action: 'Refresh',
    fields: [],
  },
  pcap: {
    label: 'Packet Capture',
    shortLabel: 'capture',
    Icon: Activity,
    action: 'Capture',
    fields: [
      { key: 'interface', label: 'Interface', type: 'select', placeholder: 'Select interface', required: true },
      { key: 'duration', label: 'Seconds', type: 'number', compact: true, placeholder: '5' },
      { key: 'filter', label: 'Filter', placeholder: 'tcp port 443' },
      { key: 'max_packets', label: 'Packets', type: 'number', compact: true, placeholder: '1000' },
    ],
  },
};

export const DEFAULT_FORM: Record<ToolKind, Record<string, string>> = {
  scan: { host: '127.0.0.1', ports: DEFAULT_PORTS },
  discover: { subnet: '' },
  dns: { host: 'netscli.com', record: 'ALL' },
  inspect: { host: '127.0.0.1', ports: DEFAULT_PORTS },
  sweep: { subnet: '', ports: '22,80,443' },
  interfaces: {},
  arp: {},
  pcap: { interface: '', duration: '5', filter: '', max_packets: '1000' },
};

export const DEFAULT_SORT: Record<ToolKind, string> = {
  scan: 'port',
  discover: 'ip',
  dns: 'record_type',
  inspect: 'port',
  sweep: 'ip',
  interfaces: 'name',
  arp: 'ip',
  pcap: 'metric',
};

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTab(kind: ToolKind): WorkspaceTab {
  const config = TOOL_CONFIG[kind];
  return {
    id: generateId(kind),
    kind,
    title: config.shortLabel,
    form: { ...DEFAULT_FORM[kind] },
    result: null,
    error: null,
    busy: false,
    selectedIndex: 0,
    selectedIndices: [0],
    selectionAnchor: 0,
    detailTab: kind === 'scan' ? 'banner' : 'details',
    sortKey: DEFAULT_SORT[kind],
    sortDir: 'asc',
  };
}
