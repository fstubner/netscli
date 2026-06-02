import { describe, expect, it } from 'vitest';

import type { HistoryEntry } from '../tools/types';
import { loadHistory, saveHistory } from './historyStorage';

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
});
