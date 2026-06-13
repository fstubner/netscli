import type {
  ArpEntry,
  DnsRecord,
  Host,
  InspectResult,
  InterfaceInfo,
  MdnsService,
  PcapParseResult,
  PcapResult,
  PingSummary,
  PortResult,
  ReverseDnsResult,
  SweepEntry,
  TraceResult,
} from './netscli';

type ToolResultMeta = {
  warnings?: string[];
};

export type ToolResult =
  | ({ kind: 'discover'; data: Host[] } & ToolResultMeta)
  | ({ kind: 'scan'; data: PortResult[] } & ToolResultMeta)
  | ({ kind: 'ping'; data: PingSummary } & ToolResultMeta)
  | ({ kind: 'trace'; data: TraceResult } & ToolResultMeta)
  | ({ kind: 'reverse'; data: ReverseDnsResult } & ToolResultMeta)
  | ({ kind: 'inspect'; data: InspectResult } & ToolResultMeta)
  | ({ kind: 'sweep'; data: SweepEntry[] } & ToolResultMeta)
  | ({ kind: 'dns'; data: DnsRecord[] } & ToolResultMeta)
  | ({ kind: 'mdns'; data: MdnsService[] } & ToolResultMeta)
  | ({ kind: 'interfaces'; data: InterfaceInfo[] } & ToolResultMeta)
  | ({ kind: 'arp'; data: ArpEntry[] } & ToolResultMeta)
  | ({ kind: 'pcap'; data: PcapResult | PcapParseResult } & ToolResultMeta);
