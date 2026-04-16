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

export type Tab =
  | 'dashboard'
  | 'discover'
  | 'scan'
  | 'inspect'
  | 'sweep'
  | 'dns'
  | 'interfaces'
  | 'pcap'
  | 'settings';

export type ToolResult =
  | { kind: 'discover'; data: Host[] }
  | { kind: 'scan'; data: PortResult[] }
  | { kind: 'inspect'; data: InspectResult }
  | { kind: 'sweep'; data: SweepEntry[] }
  | { kind: 'dns'; data: DnsRecord[] }
  | { kind: 'interfaces'; data: InterfaceInfo[] }
  | { kind: 'arp'; data: ArpEntry[] }
  | { kind: 'pcap'; data: PcapResult };

export type ToolParams =
  | { kind: 'discover'; subnet?: string }
  | { kind: 'scan'; host: string; ports?: string }
  | { kind: 'inspect'; host: string; ports?: string }
  | { kind: 'sweep'; subnet?: string; ports?: string }
  | {
      kind: 'dns';
      host: string;
      // Accept any record type the backend supports, plus ALL/ANY aggregate queries.
      record: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'TXT' | 'SRV' | 'PTR' | 'SOA' | 'CAA' | 'ALL' | 'ANY';
    }
  | { kind: 'interfaces' }
  | { kind: 'arp' }
  | {
      kind: 'pcap';
      interface: string;
      duration?: number;
      filter?: string;
      max_packets?: number;
      output_file?: string;
    };

export type TabViewMode = 'results' | 'history';

export interface HistoryEntry {
  id: string;
  tab: Tab;
  timestamp: Date;
  params: ToolParams;
  result: ToolResult;
}
