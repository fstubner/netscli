import { describe, expect, it } from 'vitest';

import { tabDisplayFor } from '../components/shell/tabDisplay';
import { createTab } from './registry';
import {
  buildCommand,
  buildRows,
  columnsFor,
  copyContextForCell,
  csvEscape,
  detailTabsFor,
  filterHintsFor,
  filterAndSortRows,
  inspectOverviewLines,
  inspectPortsLines,
  latencyOf,
  latencyOfPort,
  portBannerLines,
  portHeaderLines,
  portRawPreview,
  portTlsLines,
  resultSummary,
  selectedRowsRawPreview,
  serializeRowsAsCsv,
  selectionSummaryLines,
  tabIdentity,
} from './presentation';
import type { ResultColumn } from './types';
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

describe('buildCommand', () => {
  it('builds command previews for every tool', () => {
    const scan = createTab('scan');
    scan.form.host = '1.1.1.1';
    expect(buildCommand(scan)).toBe('netscli scan 1.1.1.1 -p 22,80,443,8080,8443 --json');

    const discover = createTab('discover');
    discover.form.subnet = '192.168.1.0/24';
    expect(buildCommand(discover)).toBe('netscli discover 192.168.1.0/24 --resolve --json');

    const dns = createTab('dns');
    dns.form.host = 'netscli.com';
    dns.form.record = 'MX';
    expect(buildCommand(dns)).toBe('netscli dns netscli.com --record MX --json');
    dns.form.record = 'ALL';
    expect(buildCommand(dns)).toBe('netscli dns netscli.com --json');

    const inspect = createTab('inspect');
    inspect.form.host = 'router.local';
    inspect.form.ports = '22,443';
    expect(buildCommand(inspect)).toBe('netscli inspect router.local -p 22,443 --json');

    const sweep = createTab('sweep');
    sweep.form.subnet = '10.0.0.0/24';
    sweep.form.ports = '80,443';
    expect(buildCommand(sweep)).toBe('netscli sweep 10.0.0.0/24 -p 80,443 --resolve --json');

    expect(buildCommand(createTab('interfaces'))).toBe('netscli interfaces --json');
    expect(buildCommand(createTab('arp'))).toBe('netscli arp --json');

    const pcap = createTab('pcap');
    pcap.form.interface = 'Ethernet';
    pcap.form.duration = '10';
    pcap.form.filter = 'tcp port 443';
    pcap.form.max_packets = '50';
    expect(buildCommand(pcap)).toBe(
      'netscli pcap --interface Ethernet --duration 10 --filter "tcp port 443" --max-packets 50 --json',
    );
  });

  it('omits -p when the ports field is empty, because that is what runs', () => {
    // The preview used to substitute the GUI's five-port placeholder while
    // execution sent no port list and the core used its own default of three.
    // The copied command, the History entry and the saved bundle all carried
    // the wrong string.
    const scan = createTab('scan');
    scan.form.host = 'router.local';
    scan.form.ports = '';
    expect(buildCommand(scan)).toBe('netscli scan router.local --json');
  });

  it('escapes quotes in a capture filter so the preview stays paste-able', () => {
    const pcap = createTab('pcap');
    pcap.form.interface = 'eth0';
    pcap.form.filter = 'host "example"';
    expect(buildCommand(pcap)).toContain('--filter "host \\"example\\""');
  });
});

describe('tabIdentity', () => {
  it('uses operation label plus compact target context instead of command text', () => {
    const emptyScan = createTab('scan');
    expect(tabIdentity(emptyScan)).toEqual({ label: 'Scan', identifier: '127.0.0.1' });

    const scan = createTab('scan');
    scan.form.host = '1.1.1.1';
    expect(tabIdentity(scan)).toEqual({ label: 'Scan', identifier: '1.1.1.1' });

    scan.form.ports = '22,443';
    expect(tabIdentity(scan)).toEqual({ label: 'Scan', identifier: '1.1.1.1 - 22,443' });

    const dns = createTab('dns');
    expect(tabIdentity(dns)).toEqual({ label: 'DNS', identifier: 'netscli.com' });
    dns.form.host = 'netscli.com';
    dns.form.record = 'AAAA';
    expect(tabIdentity(dns)).toEqual({ label: 'DNS', identifier: 'netscli.com - AAAA' });

    expect(tabIdentity(createTab('interfaces'))).toEqual({
      label: 'Interfaces',
      identifier: '',
    });
    expect(tabIdentity(createTab('arp'))).toEqual({ label: 'ARP', identifier: '' });

    const pcap = createTab('pcap');
    pcap.form.interface = 'Eth 2.5G';
    expect(tabIdentity(pcap)).toEqual({ label: 'Packet Capture', identifier: 'Eth 2.5G' });
  });

  it('keeps tab hover text compact and leaves CLI commands to the command bar', () => {
    const scan = createTab('scan');
    scan.form.host = '127.0.0.1';
    const { tooltip } = tabDisplayFor(scan, 0, [{ label: 'Scan', identifier: '127.0.0.1' }]);

    expect(tooltip).toBe('Scan: 127.0.0.1');
    expect(tooltip).not.toMatch(/netscli|--json|<host>/i);
  });
});

describe('result presentation', () => {
  it('summarizes empty and populated results', () => {
    expect(resultSummary(null)).toBe('0 results');
    expect(
      resultSummary({
        kind: 'scan',
        data: [portResult(80, 'open'), portResult(81, 'closed'), portResult(82, 'filtered')],
      }),
    ).toBe('3 results - 1 open');
    expect(
      resultSummary({
        kind: 'inspect',
        data: {
          host: '127.0.0.1',
          ports: [portResult(22, 'filtered'), portResult(80, 'closed'), portResult(443, 'open')],
          open_ports: [portResult(443, 'open')],
          ping: { ip: '127.0.0.1', alive: false, seq: 0 },
        },
      }),
    ).toBe('3 ports checked - 1 open');
    expect(
      resultSummary({
        kind: 'inspect',
        data: {
          host: '127.0.0.1',
          ports: [portResult(8080, 'open')],
          open_ports: [portResult(8080, 'open')],
          ping: { ip: '127.0.0.1', alive: true, seq: 0 },
        },
      }),
    ).toBe('1 port checked - 1 open');
    expect(
      resultSummary({
        kind: 'inspect',
        data: {
          host: '127.0.0.1',
          open_ports: [],
          ping: { ip: '127.0.0.1', alive: false, seq: 0 },
        },
      }),
    ).toBe('host down - 0 open ports');
  });

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

  it('selects detail tabs by row type', () => {
    const rows = buildRows({ kind: 'scan', data: [portResult(443, 'open')] });
    expect(detailTabsFor(rows[0])).toEqual(['banner', 'headers', 'tls', 'raw']);
    expect(detailTabsFor(rows[0], 2)).toEqual(['selection', 'raw']);
    expect(detailTabsFor(undefined)).toEqual(['details', 'raw']);
  });

  it('builds host-profile detail content for inspect results', () => {
    const result = {
      host: '127.0.0.1',
      ip: '127.0.0.1',
      hostname: 'localhost',
      ports: [portResult(22, 'filtered'), portResult(443, 'open', 9, 'nginx')],
      open_ports: [portResult(443, 'open', 9, 'nginx')],
      ping: { ip: '127.0.0.1', alive: true, seq: 0, method: 'tcp-connect', rtt_ms: 2 },
    };
    const rows = buildRows({ kind: 'inspect', data: result });

    expect(inspectOverviewLines(result).map((line) => [line.label, line.value])).toEqual(
      expect.arrayContaining([
        ['Host', '127.0.0.1'],
        ['Reverse DNS', 'localhost'],
        ['Ports Checked', '2'],
        ['Open Ports', '1'],
      ]),
    );
    expect(inspectPortsLines(result, rows[0]).map((line) => [line.label, line.value])).toEqual(
      expect.arrayContaining([
        ['Selected Port', '22'],
        ['Status', 'filtered'],
        ['Meaning', 'The probe timed out or was blocked before connect.'],
      ]),
    );
    expect(inspectPortsLines(result, undefined).find((line) => line.label === 'Open Ports')?.value).toBe('443');
  });

  it('keeps DNS record type compact and leaves value column to fill the table', () => {
    const columns = columnsFor('dns', null);
    expect(columns[0]).toMatchObject({ key: 'record_type', width: 72 });
    expect(columns[1]).toMatchObject({ key: 'value', grow: true });
    expect(columns.map((column) => column.key)).toContain('ttl');
    expect(columns.map((column) => column.key)).toContain('resolver');
  });

  it('does not let empty optional columns consume the main table width', () => {
    const discoverWithoutHostnames: ToolResult = {
      kind: 'discover',
      data: [
        {
          ip: '192.168.1.125',
          hostname: '',
          mac: '00:17:88:6E:6C:5C',
          vendor: 'Philips Lighting BV',
        },
      ],
    };
    const emptyHostnameColumns = columnsFor('discover', discoverWithoutHostnames);
    expect(emptyHostnameColumns.find((column) => column.key === 'hostname')).toMatchObject({
      width: 130,
    });
    expect(emptyHostnameColumns.find((column) => column.key === 'vendor')).toMatchObject({
      grow: true,
    });

    const discoverWithHostname: ToolResult = {
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
    expect(columnsFor('discover', discoverWithHostname).find((column) => column.key === 'hostname')).toMatchObject({
      grow: true,
    });
  });

  it('summarizes multi-row detail selections', () => {
    const rows = buildRows({
      kind: 'scan',
      data: [portResult(80, 'open', 14), portResult(443, 'filtered'), portResult(22, 'closed', 3)],
    });
    const lines = selectionSummaryLines(rows, [
      { key: 'port', label: 'Port' },
      { key: 'status', label: 'Status' },
    ]);

    expect(lines.find((line) => line.label === 'Selected Rows')?.value).toBe('3');
    expect(lines.find((line) => line.label === 'Statuses')?.value).toContain('open: 1');
    expect(lines.find((line) => line.label === 'Open Ports')?.value).toBe('80');
    expect(selectedRowsRawPreview(rows)).toContain('"port": 443');
  });

  it('explains missing port probe details instead of showing empty panes', () => {
    const filtered = portResult(22, 'filtered');
    expect(portBannerLines(filtered, '')[0]?.value).toBe('No plaintext banner captured');
    expect(portBannerLines(filtered, '')[1]?.value).toMatch(/timed out/i);
    expect(portHeaderLines(filtered)[0]?.value).toBe('No HTTP response captured');
    expect(portTlsLines(filtered)[0]?.value).toBe('No TLS handshake captured');
    expect(portRawPreview(filtered)).toContain('"status": "filtered"');

    const openUnknown = portResult(25565, 'open', 86);
    openUnknown.service = undefined;
    expect(portHeaderLines(openUnknown)[1]?.value).toMatch(/not HTTP-like/i);
    expect(portTlsLines(openUnknown)[1]?.value).toMatch(/not TLS-like/i);
  });

  it('escapes CSV output', () => {
    expect(csvEscape('a,b"c\n')).toBe('"a,b""c\n"');

    const columns: ResultColumn[] = [
      { key: 'name', label: 'Name' },
      { key: 'value', label: 'Value' },
    ];
    const csv = serializeRowsAsCsv(columns, [
      {
        id: 'row-1',
        kind: 'dns',
        data: { name: 'txt', value: 'hello, "world"' },
        raw: {},
        searchText: '',
      },
    ]);
    expect(csv).toBe('Name,Value\ntxt,"hello, ""world"""');
  });

  it('builds copy context for populated result cells only', () => {
    const row = {
      id: 'row-1',
      kind: 'discover' as const,
      data: { ip: '192.168.1.125', hostname: '', vendor: 'Philips Lighting BV' },
      raw: {},
      searchText: '',
    };

    expect(copyContextForCell(row, { key: 'vendor', label: 'Vendor' })).toEqual({
      columnKey: 'vendor',
      label: 'Vendor',
      value: 'Philips Lighting BV',
      row: {
        id: 'row-1',
        kind: 'discover',
        data: { ip: '192.168.1.125', hostname: '', vendor: 'Philips Lighting BV' },
      },
    });
    expect(copyContextForCell(row, { key: 'hostname', label: 'Hostname' })).toBeNull();
  });
});
