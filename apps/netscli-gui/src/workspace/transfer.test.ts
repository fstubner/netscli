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

  it('rejects pcap data without packets', () => {
    expect(() => parseResultBundle(bundle({ kind: 'pcap', result: { kind: 'pcap', data: {} } }))).toThrow(
      /pcap data must include packets/i,
    );
  });
});
