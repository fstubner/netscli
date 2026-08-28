// Turning a tool result into table rows: normalisation across statuses,
// inspect and capture shapes, and the filtering and sorting applied on top.
//
// Split out of presentation.test.ts, which carried a transition exception at
// 500 lines. Its stated next step was "row and column building are the next
// families out"; this is the row half.

import { describe, expect, it } from 'vitest';

import {
  buildRows,
  columnsFor,
  filterAndSortRows,
  filterHintsFor,
  latencyOf,
  latencyOfPort,
} from './presentation';
import { createTab } from './registry';
import type { ToolResult } from '../types/app';
import type { PortResult, PortStatus } from '../types/netscli';

function portResult(port: number, status: PortStatus, latency_ms?: number, banner?: string): PortResult {
  return {
    port,
    open: status === 'open',
    status,
    service: port === 443 ? 'https' : 'http',
    latency_ms,
    banner,
  };
}

describe('row building', () => {
  it('normalizes port rows across statuses and latency states', () => {
    const result: ToolResult = {
      kind: 'scan',
      data: [
        portResult(80, 'open', 14, 'cloudflare'),
        portResult(22, 'closed', 8),
        portResult(443, 'filtered'),
        portResult(8443, 'error', undefined, 'probe failed'),
      ],
    };

    const rows = buildRows(result);
    expect(rows.map((row) => row.data.status)).toEqual(['open', 'closed', 'filtered', 'error']);
    // The `error` row reads '-' rather than ''. This assertion previously
    // pinned the table's own formatter, which returned '' where the detail
    // pane returned a reason for the same port -- the M-7 divergence. Both
    // now come from one function, so a port with no measured latency always
    // explains itself.
    expect(rows.map((row) => row.data.latency)).toEqual(['14 ms', '8 ms', 'timeout', '-']);
    expect(rows[0]?.searchText).toContain('cloudflare');
  });

  // M-7 regression: the table and detail pane must agree for every status.

  it('reports the same latency text in the table and the detail pane', () => {
    const statuses = ['open', 'closed', 'filtered', 'error'] as const;
    for (const status of statuses) {
      const port = portResult(80, status);
      expect(latencyOf(port)).toBe(latencyOfPort(port));
    }
    // A closed port used to be blank in the table and 'refused' in details.
    expect(latencyOf(portResult(22, 'closed'))).toBe('refused');
  });

  it('normalizes inspect rows from all scanned ports, not only open ports', () => {
    const rows = buildRows({
      kind: 'inspect',
      data: {
        host: '127.0.0.1',
        ports: [portResult(22, 'filtered'), portResult(80, 'closed'), portResult(443, 'open')],
        open_ports: [portResult(443, 'open')],
        ping: { ip: '127.0.0.1', alive: false, seq: 0 },
        hostname: 'localhost',
      },
    });

    expect(rows.map((row) => row.data.port)).toEqual([22, 80, 443]);
    expect(rows.map((row) => row.data.status)).toEqual(['filtered', 'closed', 'open']);
    expect(columnsFor('inspect', null, rows).map((column) => column.key)).toContain('port');
  });

  it('normalizes PCAP captures into packet rows instead of a capture summary row', () => {
    const rows = buildRows({
      kind: 'pcap',
      data: {
        packets_captured: 1,
        duration: { secs: 1, nanos: 250_000_000 },
        file_path: 'capture.pcap',
        packets_truncated: false,
        packets: [
          {
            index: 1,
            timestamp: '1716900000.000001',
            source: '192.168.1.10',
            destination: '1.1.1.1',
            protocol: 'TCP',
            length: 54,
            captured_length: 54,
            info: '54231 -> 443 [SYN] Len=0',
            source_port: 54231,
            destination_port: 443,
            tcp_flags: 'SYN',
            hex_preview: '00 11',
          },
        ],
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({
      no: 1,
      source: '192.168.1.10',
      destination: '1.1.1.1',
      protocol: 'TCP',
      ports: '54231 -> 443',
      length: 54,
    });
    expect(columnsFor('pcap', null).map((column) => column.key)).toEqual([
      'no',
      'time',
      'source',
      'destination',
      'protocol',
      'ports',
      'length',
      'info',
    ]);
  });

  it('filters and sorts normalized rows', () => {
    const tab = createTab('scan');
    tab.sortKey = 'port';
    tab.sortDir = 'desc';

    const rows = buildRows({
      kind: 'scan',
      data: [portResult(80, 'open', 14, 'nginx'), portResult(443, 'open', 12, 'cloudflare')],
    });

    expect(filterAndSortRows(rows, tab, '').map((row) => row.data.port)).toEqual([443, 80]);
    expect(filterAndSortRows(rows, tab, 'nginx').map((row) => row.data.port)).toEqual([80]);
    expect(filterAndSortRows(rows, tab, 'status:open port:443').map((row) => row.data.port)).toEqual([
      443,
    ]);
    expect(filterAndSortRows(rows, tab, '-service:http').map((row) => row.data.port)).toEqual([]);
  });

  it('keeps quoted field filters together for multi-word values', () => {
    const tab = createTab('sweep');
    tab.sortKey = 'ip';
    tab.result = {
      kind: 'sweep',
      data: [
        {
          host: {
            ip: '192.168.1.74',
            vendor: 'WNC Corporation',
          },
          open_ports: [portResult(22, 'open')],
        },
        {
          host: {
            ip: '192.168.1.125',
            vendor: 'Philips Lighting BV',
          },
          open_ports: [portResult(80, 'open')],
        },
      ],
    };

    const rows = buildRows(tab.result);
    expect(filterAndSortRows(rows, tab, 'vendor:"WNC Corporation"').map((row) => row.data.ip)).toEqual([
      '192.168.1.74',
    ]);
    expect(filterAndSortRows(rows, tab, 'vendor:"Philips Lighting BV"').map((row) => row.data.ip)).toEqual([
      '192.168.1.125',
    ]);
  });

  it('builds tab-aware filter hints without site-specific canned values', () => {
    const dns = createTab('dns');
    dns.result = {
      kind: 'dns',
      data: [
        { record_type: 'A', value: '185.199.110.153' },
        { record_type: 'MX', value: '10 mail.example.test', ttl_seconds: 300, resolver_source: 'system' },
      ],
    };
    const dnsHints = filterHintsFor(dns);
    const dnsText = JSON.stringify(dnsHints);
    expect(dnsHints.placeholder).toContain('type:A');
    expect(dnsText).toContain('type:A');
    expect(dnsText).toContain('value:185.199.110.153');
    expect(dnsText).toContain('resolver:system');
    expect(dnsText).not.toMatch(/GitHub Pages|vendor:apple|value:mail/i);

    const discover = createTab('discover');
    discover.result = {
      kind: 'discover',
      data: [
        {
          ip: '192.168.1.125',
          hostname: 'lamp.local',
          mac: '00:17:88:6E:6C:5C',
          vendor: 'Philips Lighting BV',
        },
      ],
    };
    const discoverHints = filterHintsFor(discover);
    const discoverValues = discoverHints.sections.flatMap((section) => section.options.map((option) => option[1]));
    expect(discoverValues).toContain('ip:192.168.1.125');
    expect(discoverValues).toContain('vendor:"Philips Lighting BV"');
    expect(JSON.stringify(discoverHints)).not.toContain('vendor:apple');
  });
});
