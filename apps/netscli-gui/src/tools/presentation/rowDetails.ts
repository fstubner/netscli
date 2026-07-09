import type { ResultRow } from '../types';
import type { DetailLine } from './detailLine';

export function detailLinesForRow(row: ResultRow): DetailLine[] {
  if (row.kind === 'pcap') return pcapDetailLines(row.raw);

  const lines = Object.entries(row.data).map(([key, value]) => ({
    label: key,
    value: value == null || value === '' ? '-' : String(value),
  }));

  switch (row.kind) {
    case 'ping':
      return pingDetailLines(row.raw);
    case 'trace':
      return traceDetailLines(row.raw);
    case 'reverse':
      return [
        ...lines,
        {
          label: 'Summary',
          value: row.data.hostname ? 'Reverse DNS name found for this IP.' : 'No reverse DNS name returned.',
          muted: !row.data.hostname,
        },
      ];
    case 'discover':
      return [
        ...lines,
        {
          label: 'Summary',
          value: `Responded host${row.data.vendor ? ', known vendor' : ', vendor unknown'}`,
        },
      ];
    case 'sweep':
      return [
        ...lines,
        {
          label: 'Summary',
          value: Number(row.data.open_ports || 0) > 0
            ? `${row.data.open_ports} open service group(s) found`
            : 'No exposed services found on scanned ports',
        },
      ];
    case 'arp':
      return [
        { label: 'Source', value: 'Local neighbor cache' },
        ...lines,
      ];
    case 'interfaces':
      return [
        ...lines,
        {
          label: 'Summary',
          value: `${row.data.state || 'unknown'} ${row.data.kind || 'interface'}`,
        },
      ];
    case 'dns':
      return lines.filter((line) => line.value !== '-');
    case 'mdns':
      return mdnsDetailLines(row.raw);
    default:
      return lines;
  }
}

function pingDetailLines(raw: unknown): DetailLine[] {
  const summary = raw as Record<string, unknown>;
  const sent = Number(summary.sent ?? 0);
  const received = Number(summary.received ?? 0);
  const loss = Number(summary.loss_pct ?? 0);
  return [
    { label: 'Host', value: valueOrDash(summary.host) },
    { label: 'Resolved IP', value: valueOrDash(summary.ip) },
    { label: 'Sent', value: valueOrDash(summary.sent) },
    { label: 'Received', value: valueOrDash(summary.received) },
    { label: 'Packet Loss', value: `${formatNumeric(loss)}%`, muted: loss > 0 },
    { label: 'RTT Average', value: optionalMs(summary.rtt_ms_avg) },
    { label: 'RTT Min', value: optionalMs(summary.rtt_ms_min) },
    { label: 'RTT Max', value: optionalMs(summary.rtt_ms_max) },
    {
      label: 'Summary',
      value:
        received > 0
          ? `${received} of ${sent} probes replied.`
          : 'No replies were received before timeout.',
      muted: received === 0,
    },
  ];
}

function traceDetailLines(raw: unknown): DetailLine[] {
  const hop = raw as Record<string, unknown>;
  return [
    { label: 'Hop', value: valueOrDash(hop.hop) },
    { label: 'Status', value: valueOrDash(hop.status) },
    { label: 'Best RTT', value: valueOrDash(hop.best) },
    { label: 'Average RTT', value: valueOrDash(hop.avg) },
    { label: 'Worst RTT', value: valueOrDash(hop.worst) },
    { label: 'Address / Host', value: valueOrDash(hop.address) },
    { label: 'Tool', value: valueOrDash(hop.tool) },
    { label: 'Exit Code', value: valueOrDash(hop.exit_code) },
    { label: 'Output', value: valueOrDash(hop.line) },
  ];
}

function mdnsDetailLines(raw: unknown): DetailLine[] {
  const service = raw as Record<string, unknown>;
  const properties = service.properties && typeof service.properties === 'object'
    ? Object.entries(service.properties as Record<string, unknown>)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ')
    : '';
  return [
    { label: 'Service Type', value: valueOrDash(service.service_type) },
    { label: 'Hostname', value: valueOrDash(service.hostname) },
    { label: 'Addresses', value: Array.isArray(service.addresses) ? service.addresses.join(', ') : '-' },
    { label: 'Port', value: valueOrDash(service.port) },
    { label: 'Full Name', value: valueOrDash(service.full_name) },
    { label: 'TXT Properties', value: properties || '-', muted: !properties },
  ];
}

function pcapDetailLines(raw: unknown): DetailLine[] {
  const packet = raw as Record<string, unknown>;
  const lines: DetailLine[] = [
    { label: 'No.', value: valueOrDash(packet.index) },
    { label: 'Timestamp', value: valueOrDash(packet.timestamp) },
    { label: 'Protocol', value: valueOrDash(packet.protocol) },
    { label: 'Source', value: valueOrDash(packet.source) },
    { label: 'Destination', value: valueOrDash(packet.destination) },
    { label: 'Length', value: valueOrDash(packet.length) },
    { label: 'Captured', value: valueOrDash(packet.captured_length) },
    { label: 'Info', value: valueOrDash(packet.info) },
  ];

  addOptionalLine(lines, 'Ethernet source', packet.ethernet_source);
  addOptionalLine(lines, 'Ethernet destination', packet.ethernet_destination);
  addOptionalLine(lines, 'Source port', packet.source_port);
  addOptionalLine(lines, 'Destination port', packet.destination_port);
  addOptionalLine(lines, 'TCP flags', packet.tcp_flags);
  addOptionalLine(lines, 'ICMP type', packet.icmp_type);
  addOptionalLine(lines, 'ICMP code', packet.icmp_code);
  addOptionalLine(lines, 'ARP operation', packet.arp_operation);
  addOptionalLine(lines, 'Hex preview', packet.hex_preview);

  return lines;
}

function addOptionalLine(lines: DetailLine[], label: string, value: unknown) {
  if (value == null || value === '') return;
  lines.push({ label, value: String(value) });
}

function valueOrDash(value: unknown): string {
  return value == null || value === '' ? '-' : String(value);
}

function optionalMs(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumeric(value)} ms` : '-';
}

function formatNumeric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
