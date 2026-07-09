import type { HistoryEntry } from '../tools/types';

const HISTORY_STORAGE_KEY = 'netscli.workspace.history';
const HISTORY_LIMIT = 20;
const HISTORY_ENTRY_CHAR_LIMIT = 150_000;
const HISTORY_TOTAL_CHAR_LIMIT = 750_000;

interface StoredHistoryEntry extends Omit<HistoryEntry, 'timestamp'> {
  timestamp: string;
}

interface HistoryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadHistory(storage = browserStorage()): HistoryEntry[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as StoredHistoryEntry[];
    if (!Array.isArray(entries)) return [];

    return compactHistory(entries
      .map((entry) => reviveHistoryEntry(entry))
      .filter((entry): entry is HistoryEntry => Boolean(entry)));
  } catch {
    return [];
  }
}

export function compactHistory(history: HistoryEntry[]): HistoryEntry[] {
  const compacted: HistoryEntry[] = [];
  let totalChars = 2;

  for (const entry of history.slice(0, HISTORY_LIMIT)) {
    const stored = toStoredHistoryEntry(entry);
    const serialized = JSON.stringify(stored);
    if (serialized.length > HISTORY_ENTRY_CHAR_LIMIT) continue;

    const separatorChars = compacted.length === 0 ? 0 : 1;
    if (totalChars + separatorChars + serialized.length > HISTORY_TOTAL_CHAR_LIMIT) break;

    compacted.push(entry);
    totalChars += separatorChars + serialized.length;
  }

  return compacted;
}

export function saveHistory(history: HistoryEntry[], storage = browserStorage()) {
  if (!storage) return;

  try {
    const compacted = compactHistory(history);
    if (compacted.length === 0) {
      storage.removeItem(HISTORY_STORAGE_KEY);
      return;
    }

    const entries: StoredHistoryEntry[] = compacted.map((entry) => toStoredHistoryEntry(entry));
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // History is useful, but never worth breaking the workspace over.
  }
}

function toStoredHistoryEntry(entry: HistoryEntry): StoredHistoryEntry {
  return {
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  };
}

function reviveHistoryEntry(entry: StoredHistoryEntry): HistoryEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.id !== 'string' || typeof entry.command !== 'string' || typeof entry.tabTitle !== 'string') {
    return null;
  }

  const timestamp = new Date(entry.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    ...entry,
    form: entry.form && typeof entry.form === 'object' ? entry.form : {},
    timestamp,
  };
}

function browserStorage(): HistoryStorageLike | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
