import type { PortResult, PortStatus } from '../../types/netscli';
import type { DetailTab, ResultColumn, ResultRow } from '../types';

export interface DetailLine {
  label: string;
  value: string;
  muted?: boolean;
}

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

export function portBannerLines(port: PortResult, latency: string): DetailLine[] {
  return [
    {
      label: 'Banner',
      value: port.banner?.trim() || 'No plaintext banner captured',
      muted: !port.banner?.trim(),
    },
    {
      label: 'Reason',
      value: port.banner?.trim() ? 'Application data was captured during the banner probe.' : bannerReason(port),
      muted: !port.banner?.trim(),
    },
    { label: 'Service', value: port.service || inferredProtocolLabel(port) },
    { label: 'Latency', value: latency || statusLatencyLabel(port.status) },
    { label: 'Error', value: port.error || '-' },
  ];
}

export function portHeaderLines(port: PortResult): DetailLine[] {
  const headers = port.http?.headers ?? [];
  if (port.http?.status_line || headers.length > 0) {
    return [
      { label: 'Status', value: port.http?.status_line || '-' },
      ...headers.map((header) => ({ label: header.name, value: header.value })),
    ];
  }

  return [
    { label: 'Status', value: 'No HTTP response captured', muted: true },
    { label: 'Reason', value: httpReason(port), muted: true },
  ];
}

export function portTlsLines(port: PortResult): DetailLine[] {
  if (port.tls?.protocol || port.tls?.cipher_suite || port.tls?.alpn) {
    return [
      { label: 'Protocol', value: port.tls?.protocol || '-' },
      { label: 'Cipher', value: port.tls?.cipher_suite || '-' },
      { label: 'ALPN', value: port.tls?.alpn || 'Not negotiated', muted: !port.tls?.alpn },
    ];
  }

  return [
    { label: 'Protocol', value: 'No TLS handshake captured', muted: true },
    { label: 'Reason', value: tlsReason(port), muted: true },
  ];
}

export function portRawPreview(port: PortResult): string {
  return JSON.stringify(port, null, 2);
}

function bannerReason(port: PortResult): string {
  switch (port.status) {
    case 'open':
      return 'The TCP connection opened, but the service did not send plaintext before the probe timeout.';
    case 'closed':
      return 'The connection was refused, so there was no application session to probe.';
    case 'filtered':
      return 'The TCP connect attempt timed out before application data could be read.';
    case 'error':
      return port.error || 'The probe failed before banner capture completed.';
  }
}

function httpReason(port: PortResult): string {
  if (port.status !== 'open') {
    return 'HTTP probing is skipped unless the TCP connection opens first.';
  }
  if (!isHttpLike(port)) {
    return 'This port/service is not HTTP-like, so an HTTP HEAD probe was not attempted.';
  }
  return 'The HTTP probe did not receive a status line or headers before its timeout.';
}

function tlsReason(port: PortResult): string {
  if (port.status !== 'open') {
    return 'TLS probing is skipped unless the TCP connection opens first.';
  }
  if (!isTlsLike(port)) {
    return 'This port/service is not TLS-like, so a TLS handshake probe was not attempted.';
  }
  return 'The TLS handshake did not complete before the probe timeout.';
}

function isHttpLike(port: PortResult): boolean {
  const service = port.service?.toLowerCase() ?? '';
  return service.includes('http') || [80, 443, 8000, 8008, 8080, 8443, 8888].includes(port.port);
}

function isTlsLike(port: PortResult): boolean {
  const service = port.service?.toLowerCase() ?? '';
  return service.includes('https') || service.includes('tls') || service.includes('ssl') || [443, 8443].includes(port.port);
}

function inferredProtocolLabel(port: PortResult): string {
  if (isHttpLike(port)) return 'http-like';
  if (isTlsLike(port)) return 'tls-like';
  return 'tcp';
}

function statusLatencyLabel(status: PortStatus): string {
  if (status === 'filtered') return 'timeout';
  if (status === 'closed') return 'refused';
  return '-';
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
    case 'discover':
      return 'Discovery';
    case 'dns':
      return 'DNS lookup';
    case 'inspect':
      return 'Inspect';
    case 'sweep':
      return 'Sweep';
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
