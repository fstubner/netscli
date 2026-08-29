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
  max_concurrent?: number,
): Promise<Host[]> {
  return invoke<Host[]>('discover_network', { opId: op_id, subnet, resolveHostnames: resolve_hostnames, maxConcurrent: max_concurrent });
}

export async function scanPorts(
  host: string,
  ports?: string,
  op_id?: string,
  max_concurrent?: number,
): Promise<PortResult[]> {
  return invoke<PortResult[]>('scan_ports', { opId: op_id, host, ports, maxConcurrent: max_concurrent });
}

export async function pingHost(
  host: string,
  count?: number,
  op_id?: string,
): Promise<PingSummary> {
  return invoke<PingSummary>('ping_host', { opId: op_id, host, count });
}

export async function traceRoute(
  host: string,
  max_hops?: number,
  resolve?: boolean,
  op_id?: string,
): Promise<TraceResult> {
  return invoke<TraceResult>('trace_route_cmd', { opId: op_id, host, maxHops: max_hops, resolve });
}

export async function reverseDnsLookup(
  ip: string,
  op_id?: string,
): Promise<ReverseDnsResult> {
  return invoke<ReverseDnsResult>('reverse_dns_lookup', { opId: op_id, ip });
}

export async function inspectHost(
  host: string,
  ports?: string,
  op_id?: string,
): Promise<InspectResult> {
  return invoke<InspectResult>('inspect_host_cmd', { opId: op_id, host, ports });
}

export async function sweepNetwork(
  subnet?: string,
  ports?: string,
  op_id?: string,
  resolve_hostnames?: boolean,
  max_concurrent?: number,
): Promise<SweepEntry[]> {
  return invoke<SweepEntry[]>('sweep_network', { opId: op_id, subnet, ports, resolveHostnames: resolve_hostnames, maxConcurrent: max_concurrent });
}

export async function dnsLookup(
  host: string,
  record?: string,
  op_id?: string,
): Promise<DnsRecord[]> {
  return invoke<DnsRecord[]>('dns_lookup', { opId: op_id, host, record });
}

export async function discoverMdns(
  timeout_ms?: number,
  service_types?: string[],
  op_id?: string,
): Promise<MdnsService[]> {
  return invoke<MdnsService[]>('discover_mdns', { opId: op_id, timeoutMs: timeout_ms, serviceTypes: service_types });
}

export async function listInterfaces(op_id?: string): Promise<InterfaceInfo[]> {
  return invoke<InterfaceInfo[]>('list_interfaces', { opId: op_id });
}

/** Flush the OS neighbour cache. Requires administrator rights. */
export async function clearArpTable(): Promise<void> {
  return invoke<void>('clear_arp_table');
}

export async function getArpTable(op_id?: string): Promise<ArpEntry[]> {
  return invoke<ArpEntry[]>('get_arp_table', { opId: op_id });
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
    opId: op_id,
    interface: params.interface,
    filter: params.filter,
    duration: params.duration,
    maxPackets: params.max_packets,
  });
}

export async function openPcapFile(max_packets?: number): Promise<PcapParseResult> {
  return invoke<PcapParseResult>('open_pcap_file', { maxPackets: max_packets });
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
  return invoke<FileSavePreferences>('set_file_save_ask_each_time', { askEachTime: ask_each_time });
}

export async function chooseFileSaveDefaultDirectory(): Promise<FileSavePreferences> {
  return invoke<FileSavePreferences>('choose_file_save_default_directory');
}

export async function clearFileSaveDefaultDirectory(): Promise<FileSavePreferences> {
  return invoke<FileSavePreferences>('clear_file_save_default_directory');
}

export async function cancelOperation(op_id: string): Promise<void> {
  return invoke<void>('cancel_operation', { opId: op_id });
}

export async function getNetworkStats(interfaceName?: string | null): Promise<NetworkStats> {
  return invoke<NetworkStats>('get_network_stats', { interface: interfaceName?.trim() || null });
}

/** Interfaces the traffic monitor can read counters for -- a different, and
 *  usually smaller, set than `listInterfaces`. See the Rust command. */
export async function listMonitorableInterfaces(): Promise<string[]> {
  return invoke<string[]>('list_monitorable_interfaces');
}

export async function getDefaultInterface(): Promise<DefaultInterfaceInfo> {
  return invoke<DefaultInterfaceInfo>('get_default_interface');
}

export async function exportTextFile(
  filename: string,
  contents: string,
): Promise<string> {
  return invoke<string>('export_text_file', { filename, contents, targetPath: null });
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
