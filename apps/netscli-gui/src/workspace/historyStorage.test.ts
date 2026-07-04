import { describe, expect, it } from 'vitest';

import type { HistoryEntry } from '../tools/types';
import { compactHistory, loadHistory, saveHistory } from './historyStorage';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function historyEntry(id: string): HistoryEntry {
  return {
    id,
    command: `netscli scan 127.0.0.1 --json ${id}`,
    form: { host: '127.0.0.1' },
    result: { kind: 'scan', data: [] },
    tabTitle: 'Scan 127.0.0.1',
    timestamp: new Date('2026-05-29T10:00:00.000Z'),
  };
}

describe('history storage', () => {
  it('persists history entries and restores timestamps as dates', () => {
    const fakeStorage = storage();
    saveHistory([historyEntry('one')], fakeStorage);

    const restored = loadHistory(fakeStorage);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe('one');
    expect(restored[0]?.timestamp).toBeInstanceOf(Date);
    expect(restored[0]?.timestamp.toISOString()).toBe('2026-05-29T10:00:00.000Z');
  });

  it('clears storage when history is empty', () => {
    const fakeStorage = storage();
    saveHistory([historyEntry('one')], fakeStorage);
    saveHistory([], fakeStorage);

    expect(loadHistory(fakeStorage)).toEqual([]);
  });

  it('keeps history bounded when a result payload is too large', () => {
    const fakeStorage = storage();
    const huge = historyEntry('huge');
    huge.result = {
      kind: 'scan',
      data: [{ port: 80, status: 'open', banner: 'x'.repeat(600_000) }],
    } as unknown as HistoryEntry['result'];

    saveHistory([huge, historyEntry('small')], fakeStorage);

    expect(loadHistory(fakeStorage).map((entry) => entry.id)).toEqual(['small']);
  });

  it('keeps persisted history to the newest 20 entries', () => {
    const entries = Array.from({ length: 25 }, (_, index) => historyEntry(`entry-${index}`));

    expect(compactHistory(entries).map((entry) => entry.id)).toEqual(
      entries.slice(0, 20).map((entry) => entry.id),
    );
  });
});
