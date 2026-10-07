import { describe, expect, it } from 'vitest';

import { parseResultBundle, RESULT_BUNDLE_SCHEMA } from './transfer';

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    schema: RESULT_BUNDLE_SCHEMA,
    exportedAt: '2026-06-13T00:00:00.000Z',
    title: 'Scan',
    command: 'netscli scan 127.0.0.1 --json',
    kind: 'scan',
    form: { host: '127.0.0.1' },
    result: { kind: 'scan', data: [] },
    ...overrides,
  };
}

describe('parseResultBundle', () => {
  it('accepts a structurally valid bundle', () => {
    expect(parseResultBundle(bundle()).kind).toBe('scan');
  });

  it('rejects unsupported tool kinds', () => {
    expect(() => parseResultBundle(bundle({ kind: 'unknown', result: { kind: 'unknown', data: [] } }))).toThrow(
      /unsupported result bundle tool kind/i,
    );
  });

  it('rejects mismatched result kinds', () => {
    expect(() => parseResultBundle(bundle({ result: { kind: 'dns', data: [] } }))).toThrow(/kind does not match/i);
  });

  it('rejects array-backed result kinds without array data', () => {
    expect(() => parseResultBundle(bundle({ result: { kind: 'scan', data: {} } }))).toThrow(
      /data for scan must be an array/i,
    );
  });

  // "Is an array" was the whole check, so these imported cleanly and threw
  // inside `buildRows` during render instead -- past every catch, and with
  // no error boundary mounted, which blanked the window and took every
  // other tab's state with it.
  it('rejects array data holding entries that are not objects', () => {
    expect(() => parseResultBundle(bundle({ result: { kind: 'scan', data: [null] } }))).toThrow(
      /non-object entry at index 0/i,
    );
    expect(() =>
      parseResultBundle(bundle({ result: { kind: 'scan', data: [{ port: 22 }, 'nope'] } })),
    ).toThrow(/non-object entry at index 1/i);
    // An empty array is a legitimate "scanned, found nothing".
    expect(() => parseResultBundle(bundle({ result: { kind: 'scan', data: [] } }))).not.toThrow();
  });

  // An array of objects passes every shape check, and then `buildRows` read
  // `service.addresses.join` during render and the window went to the crash
  // screen. Opening a shared bundle must not be able to do that.
  it('rejects data the screen could not draw', () => {
    const service = { service_type: '_http._tcp', hostname: 'a.local', port: 80, full_name: 'a' };
    expect(() =>
      parseResultBundle(bundle({ kind: 'mdns', result: { kind: 'mdns', data: [service] } })),
    ).toThrow(/mdns is missing fields/i);

    const whole = { ...service, addresses: ['192.168.1.5'] };
    expect(() =>
      parseResultBundle(bundle({ kind: 'mdns', result: { kind: 'mdns', data: [whole] } })),
    ).not.toThrow();
  });

  it('rejects pcap data without packets', () => {
    expect(() => parseResultBundle(bundle({ kind: 'pcap', result: { kind: 'pcap', data: {} } }))).toThrow(
      /pcap data must include packets/i,
    );
  });
});
