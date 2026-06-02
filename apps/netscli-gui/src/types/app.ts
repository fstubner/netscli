import type {
  ArpEntry,
  DnsRecord,
  Host,
  InspectResult,
  InterfaceInfo,
  PcapResult,
  PortResult,
  SweepEntry,
} from './netscli';

type ToolResultMeta = {
  warnings?: string[];
};

export type ToolResult =
  | ({ kind: 'discover'; data: Host[] } & ToolResultMeta)
  | ({ kind: 'scan'; data: PortResult[] } & ToolResultMeta)
  | ({ kind: 'inspect'; data: InspectResult } & ToolResultMeta)
  | ({ kind: 'sweep'; data: SweepEntry[] } & ToolResultMeta)
  | ({ kind: 'dns'; data: DnsRecord[] } & ToolResultMeta)
  | ({ kind: 'interfaces'; data: InterfaceInfo[] } & ToolResultMeta)
  | ({ kind: 'arp'; data: ArpEntry[] } & ToolResultMeta)
  | ({ kind: 'pcap'; data: PcapResult } & ToolResultMeta);
