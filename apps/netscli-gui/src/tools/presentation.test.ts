import { describe, expect, it } from 'vitest';

import { tabDisplayFor } from '../components/shell/tabDisplay';
import { createTab } from './registry';
import {
  buildCommand,
  buildRows,
  copyContextForCell,
  detailTabsFor,
  inspectOverviewLines,
  inspectPortsLines,
  portBannerLines,
  portHeaderLines,
  portRawPreview,
  portTlsLines,
  resultSummary,
  selectedRowsRawPreview,
  selectionSummaryLines,
  tabIdentity,
} from './presentation';
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
