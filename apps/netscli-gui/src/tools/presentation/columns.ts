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

  if (kind === 'inspect' && result?.kind === 'inspect' && result.data.open_ports.length === 0) {
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
      ];
    case 'sweep':
      return [
        { key: 'ip', label: 'Host', mono: true, width: 170 },
        hasHostname
          ? { key: 'hostname', label: 'Hostname', grow: true }
          : { key: 'hostname', label: 'Hostname', width: 130 },
        { key: 'open_ports', label: 'Open', mono: true, width: 100 },
        hasPorts
          ? { key: 'ports', label: 'Ports', mono: true, grow: true }
          : { key: 'ports', label: 'Ports', width: 120 },
        hasVendor
          ? { key: 'vendor', label: 'Vendor', grow: true }
          : { key: 'vendor', label: 'Vendor', width: 180 },
      ];
    case 'interfaces':
      return [
        { key: 'name', label: 'Interface', width: 220 },
        { key: 'ips', label: 'Addresses', mono: true, grow: true },
        { key: 'mac', label: 'MAC', mono: true, width: 190 },
        { key: 'state', label: 'State', width: 110 },
        { key: 'loopback', label: 'Loopback', width: 110 },
      ];
    case 'arp':
      return [
        { key: 'ip', label: 'IP', mono: true, width: 170 },
        { key: 'mac', label: 'MAC', mono: true, width: 190 },
        { key: 'interface', label: 'Interface', width: 160 },
        { key: 'vendor', label: 'Vendor', grow: true },
      ];
    case 'pcap':
      return [
        { key: 'no', label: 'No.', mono: true, width: 72 },
        { key: 'time', label: 'Time', mono: true, width: 170 },
        { key: 'source', label: 'Source', mono: true, width: 220 },
        { key: 'destination', label: 'Destination', mono: true, width: 220 },
        { key: 'protocol', label: 'Protocol', width: 110 },
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
