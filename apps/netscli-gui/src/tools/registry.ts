import {
  ArpTableIcon,
  DiscoverIcon,
  DnsLookupIcon,
  InspectIcon,
  InterfacesIcon,
  MdnsDiscoveryIcon,
  PacketCaptureIcon,
  PingIcon,
  PortScanIcon,
  ReverseDnsIcon,
  SweepIcon,
  TraceRouteIcon,
} from './operationIcons';
import type { DetailTab, ToolCapabilityMap, ToolConfig, ToolKind, WorkspaceTab } from './types';

export const DEFAULT_PORTS = '22,80,443,8080,8443';

export const TOOL_KINDS: ToolKind[] = [
  'scan',
  'ping',
  'trace',
  'discover',
  'dns',
  'reverse',
  'inspect',
  'sweep',
  'mdns',
  'interfaces',
  'arp',
  'pcap',
];

export const SCAN_TOOL_KINDS: ToolKind[] = ['scan', 'ping', 'trace', 'discover', 'inspect', 'sweep'];

export const LOOKUP_TOOL_KINDS: ToolKind[] = ['dns', 'reverse', 'mdns', 'interfaces', 'arp', 'pcap'];

export function availableToolKinds(
  kinds: ToolKind[],
  capabilities: ToolCapabilityMap,
): ToolKind[] {
  return kinds.filter((kind) => capabilities[kind] ?? true);
}

export const TOOL_CONFIG: Record<ToolKind, ToolConfig> = {
  scan: {
    label: 'Port Scan',
    shortLabel: 'scan',
    Icon: PortScanIcon,
    action: 'Scan',
    fields: [
      { key: 'host', label: 'Host', placeholder: '127.0.0.1', required: true },
      { key: 'ports', label: 'Ports', placeholder: DEFAULT_PORTS },
    ],
  },
  ping: {
    label: 'Ping',
    shortLabel: 'ping',
    Icon: PingIcon,
    action: 'Ping',
    fields: [
      { key: 'host', label: 'Host', placeholder: '127.0.0.1', required: true },
      { key: 'count', label: 'Count', type: 'number', compact: true, placeholder: '4', min: 1, max: 50, step: 1 },
    ],
  },
  trace: {
    label: 'Trace Route',
    shortLabel: 'trace',
    Icon: TraceRouteIcon,
    action: 'Trace',
    fields: [
      { key: 'host', label: 'Host', placeholder: '1.1.1.1', required: true },
      { key: 'max_hops', label: 'Hops', type: 'number', compact: true, placeholder: '30', min: 1, max: 255, step: 1 },
      {
        key: 'resolve',
        label: 'Names',
        type: 'select',
        compact: true,
        options: ['Off', 'On'],
      },
    ],
  },
  discover: {
    label: 'Discover',
    shortLabel: 'discover',
    Icon: DiscoverIcon,
    action: 'Discover',
    fields: [{ key: 'subnet', label: 'Subnet', placeholder: '192.168.1.0/24' }],
  },
  dns: {
    label: 'DNS Lookup',
    shortLabel: 'dns',
    Icon: DnsLookupIcon,
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
  reverse: {
    label: 'Reverse DNS',
    shortLabel: 'reverse',
    Icon: ReverseDnsIcon,
    action: 'Lookup',
    fields: [{ key: 'ip', label: 'IP', placeholder: '192.168.1.1', required: true }],
  },
  inspect: {
    label: 'Inspect',
    shortLabel: 'inspect',
    Icon: InspectIcon,
    action: 'Inspect',
    fields: [
      { key: 'host', label: 'Host', placeholder: '127.0.0.1', required: true },
      { key: 'ports', label: 'Ports', placeholder: DEFAULT_PORTS },
    ],
  },
  sweep: {
    label: 'Sweep',
    shortLabel: 'sweep',
    Icon: SweepIcon,
    action: 'Sweep',
    fields: [
      { key: 'subnet', label: 'Subnet', placeholder: '192.168.1.0/24' },
      { key: 'ports', label: 'Ports', placeholder: '22,80,443' },
    ],
  },
  mdns: {
    label: 'mDNS Discovery',
    shortLabel: 'mdns',
    Icon: MdnsDiscoveryIcon,
    action: 'Discover',
    fields: [
      { key: 'service_types', label: 'Service Types', placeholder: '_http._tcp.local., _ssh._tcp.local.' },
    ],
  },
  interfaces: {
    label: 'Interfaces',
    shortLabel: 'interfaces',
    Icon: InterfacesIcon,
    action: 'Refresh',
    fields: [],
  },
  arp: {
    label: 'ARP Table',
    shortLabel: 'arp',
    Icon: ArpTableIcon,
    action: 'Refresh',
    fields: [],
  },
  pcap: {
    label: 'Packet Capture',
    shortLabel: 'capture',
    Icon: PacketCaptureIcon,
    action: 'Capture',
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', compact: true, options: ['Capture', 'Open File'] },
      { key: 'interface', label: 'Interface', type: 'select', placeholder: 'Select interface', required: true },
      { key: 'duration', label: 'Seconds', type: 'number', compact: true, placeholder: '5', min: 1, max: 3600, step: 1 },
      { key: 'filter', label: 'Filter', placeholder: 'tcp port 443' },
      { key: 'max_packets', label: 'Packets', type: 'number', compact: true, placeholder: '1000', min: 1, max: 100000, step: 1 },
    ],
  },
};

export const DEFAULT_FORM: Record<ToolKind, Record<string, string>> = {
  scan: { host: '127.0.0.1', ports: DEFAULT_PORTS },
  ping: { host: '127.0.0.1', count: '4' },
  trace: { host: '1.1.1.1', max_hops: '30', resolve: 'Off' },
  discover: { subnet: '' },
  dns: { host: 'netscli.com', record: 'ALL' },
  reverse: { ip: '127.0.0.1' },
  inspect: { host: '127.0.0.1', ports: DEFAULT_PORTS },
  sweep: { subnet: '', ports: '22,80,443' },
  mdns: { timeout_ms: '3000', service_types: '' },
  interfaces: {},
  arp: {},
  pcap: { mode: 'Capture', interface: '', duration: '5', filter: '', max_packets: '1000' },
};

export const DEFAULT_SORT: Record<ToolKind, string> = {
  scan: 'port',
  ping: 'metric',
  trace: 'hop',
  discover: 'ip',
  dns: 'record_type',
  reverse: 'ip',
  inspect: 'port',
  sweep: 'ip',
  mdns: 'hostname',
  interfaces: 'name',
  arp: 'ip',
  pcap: 'no',
};

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** The detail pane tab a newly-created or newly-populated tab should open
 *  to: scan/inspect results default to their most relevant tab, everything
 *  else defaults to the generic details view. */
export function defaultDetailTab(kind: ToolKind): DetailTab {
  if (kind === 'scan') return 'banner';
  if (kind === 'inspect') return 'overview';
  return 'details';
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
    progress: null,
    selectedIndex: 0,
    selectedIndices: [0],
    selectionAnchor: 0,
    detailTab: defaultDetailTab(kind),
    sortKey: DEFAULT_SORT[kind],
    sortDir: 'asc',
  };
}
