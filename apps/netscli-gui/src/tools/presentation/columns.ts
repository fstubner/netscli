import type { ToolResult } from '../../types/app';
import type { ResultColumn, ResultRow, ToolKind } from '../types';
import { buildRows } from './rows';

export function columnsFor(
  kind: ToolKind,
  result: ToolResult | null,
  rows = buildRows(result),
): ResultColumn[] {
  const hasHostname = hasColumnData(rows, 'hostname');
  const hasVendor = hasColumnData(rows, 'vendor');
  const hasBanner = hasColumnData(rows, 'banner');
  const hasPorts = hasColumnData(rows, 'ports');
  const hasMac = hasColumnData(rows, 'mac');

  const inspectPorts = result?.kind === 'inspect' ? (result.data.ports ?? result.data.open_ports) : [];
  if (kind === 'inspect' && result?.kind === 'inspect' && inspectPorts.length === 0) {
    return [
      { key: 'host', label: 'Host', mono: true, width: 220 },
      { key: 'ip', label: 'IP', mono: true, width: 220 },
      { key: 'status', label: 'Status', width: 160 },
      { key: 'latency', label: 'Latency', mono: true, width: 160 },
      hasHostname
        ? { key: 'hostname', label: 'Hostname', grow: true }
        : { key: 'hostname', label: 'Hostname', width: 150 },
    ];
  }

  switch (kind) {
    case 'scan':
    case 'inspect':
      return [
        { key: 'port', label: 'Port', mono: true, width: 90 },
        { key: 'proto', label: 'Proto', width: 110 },
        { key: 'service', label: 'Service', mono: true, width: 170 },
        { key: 'status', label: 'Status', width: 150 },
        { key: 'latency', label: 'Latency', mono: true, width: 150 },
        hasBanner
          ? { key: 'banner', label: 'Banner', grow: true }
          : { key: 'banner', label: 'Banner', width: 160 },
      ];
    case 'ping':
      return [
        { key: 'metric', label: 'Metric', width: 120 },
        { key: 'host', label: 'Host', mono: true, width: 220 },
        { key: 'ip', label: 'Resolved IP', mono: true, width: 220 },
        { key: 'sent', label: 'Sent', mono: true, width: 90 },
        { key: 'received', label: 'Received', mono: true, width: 110 },
        { key: 'loss', label: 'Loss', mono: true, width: 100 },
        { key: 'avg', label: 'Avg RTT', mono: true, width: 120 },
        { key: 'range', label: 'RTT Range', mono: true, grow: true },
      ];
    case 'trace':
      return [
        { key: 'hop', label: 'Hop', mono: true, width: 90 },
        { key: 'status', label: 'Status', width: 120 },
        { key: 'best', label: 'Best', mono: true, width: 120 },
        { key: 'avg', label: 'Avg', mono: true, width: 120 },
        { key: 'worst', label: 'Worst', mono: true, width: 120 },
        { key: 'address', label: 'Address / Host', mono: true, grow: true },
      ];
    case 'discover':
      return [
        { key: 'ip', label: 'IP', mono: true, width: 170 },
        hasHostname
          ? { key: 'hostname', label: 'Hostname', grow: true }
          : { key: 'hostname', label: 'Hostname', width: 130 },
        { key: 'mac', label: 'MAC', mono: true, width: 190 },
        hasVendor
          ? { key: 'vendor', label: 'Vendor', grow: true }
          : { key: 'vendor', label: 'Vendor', width: 180 },
        { key: 'rtt', label: 'RTT', mono: true, width: 100 },
      ];
    case 'dns':
      return [
        { key: 'record_type', label: 'Type', mono: true, width: 72 },
        { key: 'value', label: 'Value', mono: true, grow: true },
        { key: 'ttl', label: 'TTL', mono: true, width: 90 },
        { key: 'resolver', label: 'Resolver', width: 130 },
      ];
    case 'reverse':
      return [
        { key: 'ip', label: 'IP', mono: true, width: 220 },
        { key: 'hostname', label: 'Reverse Name', mono: true, grow: true },
      ];
    case 'sweep':
      return [
        { key: 'ip', label: 'IP', mono: true, width: 160 },
        hasHostname
          ? { key: 'hostname', label: 'Hostname', width: 190 }
          : { key: 'hostname', label: 'Hostname', width: 130 },
        hasMac ? { key: 'mac', label: 'MAC', mono: true, width: 190 } : { key: 'mac', label: 'MAC', width: 120 },
        hasVendor
          ? { key: 'vendor', label: 'Vendor', grow: true }
          : { key: 'vendor', label: 'Vendor', width: 170 },
        { key: 'rtt', label: 'RTT', mono: true, width: 100 },
        { key: 'open_ports', label: 'Open', mono: true, width: 100 },
        hasPorts
          ? { key: 'ports', label: 'Ports', mono: true, grow: true }
          : { key: 'ports', label: 'Ports', width: 120 },
      ];
    case 'interfaces':
      return [
        { key: 'name', label: 'Interface', width: 220 },
        { key: 'ips', label: 'Addresses', mono: true, grow: true },
        { key: 'mac', label: 'MAC', mono: true, width: 190 },
        { key: 'state', label: 'State', width: 110 },
        { key: 'app', label: 'App', width: 120 },
        { key: 'kind', label: 'Kind', width: 110 },
      ];
    case 'arp':
      return [
        { key: 'ip', label: 'IP', mono: true, width: 170 },
        { key: 'mac', label: 'MAC', mono: true, width: 190 },
        { key: 'interface', label: 'Interface', width: 160 },
        { key: 'vendor', label: 'Vendor', grow: true },
      ];
    case 'mdns':
      return [
        { key: 'service_type', label: 'Service Type', mono: true, width: 210 },
        { key: 'hostname', label: 'Hostname', width: 220 },
        { key: 'addresses', label: 'Addresses', mono: true, grow: true },
        { key: 'port', label: 'Port', mono: true, width: 90 },
        { key: 'name', label: 'Name', mono: true, grow: true },
      ];
    case 'pcap':
      return [
        { key: 'no', label: 'No.', mono: true, width: 72 },
        { key: 'time', label: 'Time', mono: true, width: 170 },
        { key: 'source', label: 'Source', mono: true, width: 220 },
        { key: 'destination', label: 'Destination', mono: true, width: 220 },
        { key: 'protocol', label: 'Protocol', width: 110 },
        { key: 'ports', label: 'Ports', mono: true, width: 140 },
        { key: 'length', label: 'Length', mono: true, width: 100 },
        { key: 'info', label: 'Info', grow: true },
      ];
  }
}

function hasColumnData(rows: ResultRow[], key: string): boolean {
  return rows.some((row) => {
    const value = row.data[key];
    const text = value == null ? '' : String(value).trim();
    return text !== '' && text !== '-';
  });
}
