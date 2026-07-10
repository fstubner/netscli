import type { InspectResult } from '../../types/netscli';
import type { DetailTab, ResultColumn, ResultRow } from '../types';
import type { DetailLine } from './detailLine';
import { httpReason, latencyOfPort, portStatusMeaning, tlsReason } from './portDetails';

export type { DetailLine } from './detailLine';

export function detailTabsFor(row: ResultRow | undefined, selectedCount = row ? 1 : 0): DetailTab[] {
  if (selectedCount > 1) return ['selection', 'raw'];
  if (row?.port) return ['banner', 'headers', 'tls', 'raw'];
  return ['details', 'raw'];
}

export function selectionSummaryLines(rows: ResultRow[], columns: ResultColumn[]): DetailLine[] {
  if (rows.length === 0) return [];

  const kinds = Array.from(new Set(rows.map((row) => row.kind)));
  const lines: DetailLine[] = [
    { label: 'Selected Rows', value: String(rows.length) },
    { label: 'Result Type', value: kinds.length === 1 ? labelForKind(kinds[0]) : `${kinds.length} result types` },
  ];

  const portRows = rows.filter((row) => row.port);
  if (portRows.length > 0) {
    const statuses = countValues(portRows.map((row) => row.port?.status ?? 'unknown'));
    const openPorts = portRows
      .filter((row) => row.port?.status === 'open')
      .map((row) => row.port?.port)
      .filter((port): port is number => typeof port === 'number');
    const latencies = portRows
      .map((row) => row.port?.latency_ms)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    lines.push({ label: 'Statuses', value: formatCounts(statuses) });
    lines.push({ label: 'Open Ports', value: openPorts.length > 0 ? formatList(openPorts.map(String)) : 'No open ports in selection' });
    if (latencies.length > 0) {
      lines.push({ label: 'Latency', value: latencySummary(latencies) });
    }
    lines.push({
      label: 'Captured Data',
      value: [
        `${portRows.filter((row) => row.port?.banner?.trim()).length} banners`,
        `${portRows.filter((row) => row.port?.http?.status_line || (row.port?.http?.headers?.length ?? 0) > 0).length} HTTP`,
        `${portRows.filter((row) => row.port?.tls?.protocol || row.port?.tls?.cipher_suite).length} TLS`,
      ].join(', '),
    });
    return lines;
  }

  const recordTypeRows = rows.filter((row) => typeof row.data.record_type === 'string');
  if (recordTypeRows.length > 0) {
    lines.push({
      label: 'Record Types',
      value: formatCounts(countValues(recordTypeRows.map((row) => String(row.data.record_type)))),
    });
  }

  const stateRows = rows.filter((row) => typeof row.data.state === 'string');
  if (stateRows.length > 0) {
    lines.push({
      label: 'States',
      value: formatCounts(countValues(stateRows.map((row) => String(row.data.state || 'unknown')))),
    });
  }

  lines.push({
    label: 'Columns',
    value: columns.map((column) => column.label).join(', '),
    muted: columns.length === 0,
  });

  return lines;
}

export function selectedRowsRawPreview(rows: ResultRow[]): string {
  return JSON.stringify(rows.map((row) => row.raw), null, 2);
}

export function inspectOverviewLines(result: InspectResult): DetailLine[] {
  const ports = result.ports ?? result.open_ports;
  const open = result.open_ports.length;
  const ping = result.ping;

  return [
    { label: 'Host', value: result.host },
    { label: 'Resolved IP', value: result.ip || ping?.ip || '-' },
    { label: 'Reverse DNS', value: result.hostname || '-' },
    { label: 'Host Status', value: ping ? (ping.alive ? 'up' : 'down') : 'not checked' },
    { label: 'Ping Method', value: ping?.method || '-' },
    { label: 'RTT', value: ping?.rtt_ms == null ? '-' : `${ping.rtt_ms} ms` },
    { label: 'Ports Checked', value: ports.length > 0 ? String(ports.length) : 'host-only inspection' },
    { label: 'Open Ports', value: String(open) },
  ];
}

export function inspectPortsLines(result: InspectResult, row: ResultRow | undefined): DetailLine[] {
  if (row?.port) {
    return [
      { label: 'Selected Port', value: String(row.port.port) },
      { label: 'Service', value: row.port.service || 'tcp' },
      { label: 'Status', value: row.port.status },
      { label: 'Latency', value: latencyOfPort(row.port) },
      { label: 'Meaning', value: portStatusMeaning(row.port) },
      { label: 'Banner', value: row.port.banner?.trim() || 'No plaintext banner captured', muted: !row.port.banner?.trim() },
      { label: 'HTTP', value: row.port.http?.status_line || httpReason(row.port), muted: !row.port.http?.status_line },
      { label: 'TLS', value: row.port.tls?.protocol || tlsReason(row.port), muted: !row.port.tls?.protocol },
    ];
  }

  const ports = result.ports ?? result.open_ports;
  if (ports.length === 0) {
    return [
      { label: 'Ports', value: 'No ports were scanned for this host inspection.', muted: true },
      { label: 'What It Means', value: 'Inspect only checked host reachability and reverse DNS.' },
    ];
  }

  const statuses = countValues(ports.map((port) => port.status));
  const openPorts = ports.filter((port) => port.open).map((port) => String(port.port));
  return [
    { label: 'Checked Ports', value: formatList(ports.map((port) => String(port.port)), 16) },
    { label: 'Statuses', value: formatCounts(statuses) },
    { label: 'Open Ports', value: openPorts.length > 0 ? formatList(openPorts, 16) : 'No open ports found' },
  ];
}

function countValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => `${value}: ${count}`)
    .join(', ');
}

function formatList(values: string[], limit = 10): string {
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} +${values.length - limit} more`;
}

function latencySummary(values: number[]): string {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const avg = Math.round(total / sorted.length);
  return `${sorted[0]}-${sorted[sorted.length - 1]} ms, avg ${avg} ms`;
}

function labelForKind(kind: string): string {
  switch (kind) {
    case 'scan':
      return 'Port scan';
    case 'ping':
      return 'Ping';
    case 'trace':
      return 'Trace route';
    case 'discover':
      return 'Discovery';
    case 'dns':
      return 'DNS lookup';
    case 'reverse':
      return 'Reverse DNS';
    case 'inspect':
      return 'Inspect';
    case 'sweep':
      return 'Sweep';
    case 'mdns':
      return 'mDNS discovery';
    case 'interfaces':
      return 'Interfaces';
    case 'arp':
      return 'ARP table';
    case 'pcap':
      return 'Packet capture';
    default:
      return kind;
  }
}
