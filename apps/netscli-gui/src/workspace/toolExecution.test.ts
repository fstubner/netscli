import { describe, expect, it, vi } from 'vitest';

import { createTab } from '../tools/registry';
import { executeTool, validateTab } from './toolExecution';

vi.mock('../services/env', () => ({
  isTauri: () => true,
}));

vi.mock('../services/netscli', () => ({
  dnsLookup: vi.fn(),
  discoverMdns: vi.fn(() => Promise.resolve([])),
}));

describe('validateTab', () => {
  it('requires fields marked required', () => {
    const tab = createTab('scan');
    tab.form.host = '';
    expect(validateTab(tab)).toBe('Host is required');
  });

  it('passes once required fields are filled', () => {
    const tab = createTab('scan');
    tab.form.host = '127.0.0.1';
    expect(validateTab(tab)).toBeNull();
  });

  it('does not require the interface field for pcap Open File mode', () => {
    const tab = createTab('pcap');
    tab.form.mode = 'Open File';
    tab.form.interface = '';
    expect(validateTab(tab)).toBeNull();
  });

  it('requires the interface field for pcap capture mode', () => {
    const tab = createTab('pcap');
    tab.form.mode = 'Capture';
    tab.form.interface = '';
    expect(validateTab(tab)).toBe('Interface is required');
  });
});

describe('executeTool DNS "ALL" aggregation', () => {
  it('returns every record type when all lookups succeed', async () => {
    const netscli = await import('../services/netscli');
    vi.mocked(netscli.dnsLookup).mockImplementation(async (host, recordType) => [
      { record_type: recordType, value: `${recordType}-value`, name: host } as never,
    ]);

    const tab = createTab('dns');
    tab.form.host = 'netscli.com';
    tab.form.record = 'ALL';

    const result = await executeTool(tab, 'op-1', 256);
    expect(result.kind).toBe('dns');
    if (result.kind !== 'dns') throw new Error('expected dns result');
    expect(result.data).toHaveLength(10);
    expect(result.warnings).toBeUndefined();
  });

  it('aggregates partial results and surfaces a warning when some record types fail', async () => {
    const netscli = await import('../services/netscli');
    vi.mocked(netscli.dnsLookup).mockImplementation(async (host, recordType) => {
      if (recordType === 'AAAA' || recordType === 'MX') {
        throw new Error(`no ${recordType} records`);
      }
      return [{ record_type: recordType, value: `${recordType}-value`, name: host } as never];
    });

    const tab = createTab('dns');
    tab.form.host = 'netscli.com';
    tab.form.record = 'ALL';

    const result = await executeTool(tab, 'op-2', 256);
    expect(result.kind).toBe('dns');
    if (result.kind !== 'dns') throw new Error('expected dns result');
    expect(result.data).toHaveLength(8);
    expect(result.warnings).toEqual(['Partial DNS results: no answers for AAAA, MX']);
  });

  it('throws when every record type fails', async () => {
    const netscli = await import('../services/netscli');
    vi.mocked(netscli.dnsLookup).mockRejectedValue(new Error('resolver unreachable'));

    const tab = createTab('dns');
    tab.form.host = 'netscli.com';
    tab.form.record = 'ALL';

    await expect(executeTool(tab, 'op-3', 256)).rejects.toThrow(/DNS resolution failed/);
  });

  it('propagates cancellation instead of treating it as a per-record failure', async () => {
    const netscli = await import('../services/netscli');
    vi.mocked(netscli.dnsLookup).mockRejectedValue(new Error('Operation cancelled'));

    const tab = createTab('dns');
    tab.form.host = 'netscli.com';
    tab.form.record = 'ALL';

    await expect(executeTool(tab, 'op-4', 256)).rejects.toThrow(/cancelled/i);
  });
});

// The mDNS timeout was the one numeric field sent to the backend without the
// registry's own min/max, even though the comment on that field said this
// path applied them.
describe('numeric form bounds', () => {
  it('clamps the mDNS timeout to the range its field declares', async () => {
    const netscli = await import('../services/netscli');
    const tab = createTab('mdns');
    // Indexed rather than `.at(-1)`, which needs a newer lib target than
    // this project sets.
    const lastTimeout = () => {
      const calls = vi.mocked(netscli.discoverMdns).mock.calls;
      return calls[calls.length - 1]?.[0];
    };

    tab.form.timeout_ms = '999999';
    await executeTool(tab, 'op-mdns-1', 64);
    expect(lastTimeout()).toBe(30000);

    tab.form.timeout_ms = '1';
    await executeTool(tab, 'op-mdns-2', 64);
    expect(lastTimeout()).toBe(500);

    tab.form.timeout_ms = '3000';
    await executeTool(tab, 'op-mdns-3', 64);
    expect(lastTimeout()).toBe(3000);
  });
});
