import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  ArpEntry,
  DefaultInterfaceInfo,
  DnsRecord,
  FileSavePreferences,
  Host,
  InspectResult,
  InterfaceInfo,
  MdnsService,
  NetworkStats,
  OptionalCapability,
  PcapCapability,
  PcapParseResult,
  PcapResult,
  PingSummary,
  PortResult,
  ReverseDnsResult,
  SweepEntry,
  TraceResult,
} from '../types/netscli';
import type { OperationProgressState } from '../tools/types';

const OPERATION_PROGRESS_EVENT = 'netscli://operation-progress';

export async function listenOperationProgress(
  handler: (progress: OperationProgressState) => void,
): Promise<UnlistenFn> {
  return listen<OperationProgressState>(OPERATION_PROGRESS_EVENT, (event) => handler(event.payload));
}

export async function discoverNetwork(
  subnet?: string,
  op_id?: string,
  resolve_hostnames?: boolean,
): Promise<Host[]> {
  return invoke<Host[]>('discover_network', { op_id, subnet, resolve_hostnames });
}

export async function scanPorts(
  host: string,
  ports?: string,
  op_id?: string,
): Promise<PortResult[]> {
  return invoke<PortResult[]>('scan_ports', { op_id, host, ports });
}

export async function pingHost(
  host: string,
  count?: number,
  op_id?: string,
): Promise<PingSummary> {
  return invoke<PingSummary>('ping_host', { op_id, host, count });
}

export async function traceRoute(
  host: string,
  max_hops?: number,
  resolve?: boolean,
  op_id?: string,
): Promise<TraceResult> {
  return invoke<TraceResult>('trace_route_cmd', { op_id, host, max_hops, resolve });
}

export async function reverseDnsLookup(
  ip: string,
  op_id?: string,
): Promise<ReverseDnsResult> {
  return invoke<ReverseDnsResult>('reverse_dns_lookup', { op_id, ip });
}

export async function inspectHost(
  host: string,
  ports?: string,
  op_id?: string,
): Promise<InspectResult> {
  return invoke<InspectResult>('inspect_host_cmd', { op_id, host, ports });
}

export async function sweepNetwork(
  subnet?: string,
  ports?: string,
  op_id?: string,
  resolve_hostnames?: boolean,
): Promise<SweepEntry[]> {
  return invoke<SweepEntry[]>('sweep_network', { op_id, subnet, ports, resolve_hostnames });
}

export async function dnsLookup(
  host: string,
  record?: string,
  op_id?: string,
): Promise<DnsRecord[]> {
  return invoke<DnsRecord[]>('dns_lookup', { op_id, host, record });
}

export async function discoverMdns(
  timeout_ms?: number,
  service_types?: string[],
  op_id?: string,
): Promise<MdnsService[]> {
  return invoke<MdnsService[]>('discover_mdns', { op_id, timeout_ms, service_types });
}

export async function listInterfaces(op_id?: string): Promise<InterfaceInfo[]> {
  return invoke<InterfaceInfo[]>('list_interfaces', { op_id });
}

export async function getArpTable(op_id?: string): Promise<ArpEntry[]> {
  return invoke<ArpEntry[]>('get_arp_table', { op_id });
}

export async function capturePcap(
  params: {
    interface: string;
    filter?: string;
    duration?: number;
    max_packets?: number;
  },
  op_id?: string,
): Promise<PcapResult> {
  return invoke<PcapResult>('capture_pcap', {
    op_id,
    interface: params.interface,
    filter: params.filter,
    duration: params.duration,
    max_packets: params.max_packets,
  });
}

export async function openPcapFile(max_packets?: number): Promise<PcapParseResult> {
  return invoke<PcapParseResult>('open_pcap_file', { max_packets });
}

export async function getPcapCapability(): Promise<PcapCapability> {
  return invoke<PcapCapability>('pcap_capability');
}

export async function getMdnsCapability(): Promise<OptionalCapability> {
  return invoke<OptionalCapability>('mdns_capability');
}

export async function getFileSavePreferences(): Promise<FileSavePreferences> {
  return invoke<FileSavePreferences>('get_file_save_preferences');
}

export async function setFileSaveAskEachTime(ask_each_time: boolean): Promise<FileSavePreferences> {
  return invoke<FileSavePreferences>('set_file_save_ask_each_time', { ask_each_time });
}

export async function chooseFileSaveDefaultDirectory(): Promise<FileSavePreferences> {
  return invoke<FileSavePreferences>('choose_file_save_default_directory');
}

export async function clearFileSaveDefaultDirectory(): Promise<FileSavePreferences> {
  return invoke<FileSavePreferences>('clear_file_save_default_directory');
}

export async function cancelOperation(op_id: string): Promise<void> {
  return invoke<void>('cancel_operation', { op_id });
}

export async function getNetworkStats(interfaceName?: string | null): Promise<NetworkStats> {
  return invoke<NetworkStats>('get_network_stats', { interface: interfaceName?.trim() || null });
}

export async function getDefaultInterface(): Promise<DefaultInterfaceInfo> {
  return invoke<DefaultInterfaceInfo>('get_default_interface');
}

export async function exportTextFile(
  filename: string,
  contents: string,
): Promise<string> {
  return invoke<string>('export_text_file', { filename, contents, target_path: null });
}

export async function saveResultBundle(contents: string): Promise<string> {
  return invoke<string>('save_result_bundle', { contents });
}

export async function openResultBundle(): Promise<unknown> {
  return invoke<unknown>('open_result_bundle');
}

export async function openFilesystemPath(path: string): Promise<void> {
  return invoke<void>('open_saved_artifact', { path });
}

export async function revealFilesystemPath(path: string): Promise<void> {
  return invoke<void>('reveal_saved_artifact', { path });
}
