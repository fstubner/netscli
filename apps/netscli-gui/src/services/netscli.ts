import { invoke } from '@tauri-apps/api/core';

import type {
  ArpEntry,
  DefaultInterfaceInfo,
  DnsRecord,
  Host,
  InspectResult,
  InterfaceInfo,
  NetworkStats,
  PcapResult,
  PortResult,
  SweepEntry,
} from '../types/netscli';

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

export async function cancelOperation(op_id: string): Promise<void> {
  return invoke<void>('cancel_operation', { op_id });
}

export async function getNetworkStats(): Promise<NetworkStats> {
  return invoke<NetworkStats>('get_network_stats');
}

export async function getDefaultInterface(): Promise<DefaultInterfaceInfo> {
  return invoke<DefaultInterfaceInfo>('get_default_interface');
}
