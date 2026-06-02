import type { HistoryEntry } from '../tools/types';

const HISTORY_STORAGE_KEY = 'netscli.workspace.history';
const HISTORY_LIMIT = 40;

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

    return entries
      .map((entry) => reviveHistoryEntry(entry))
      .filter((entry): entry is HistoryEntry => Boolean(entry))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveHistory(history: HistoryEntry[], storage = browserStorage()) {
  if (!storage) return;

  try {
    if (history.length === 0) {
      storage.removeItem(HISTORY_STORAGE_KEY);
      return;
    }

    const entries: StoredHistoryEntry[] = history.slice(0, HISTORY_LIMIT).map((entry) => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    }));
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // History is useful, but never worth breaking the workspace over.
  }
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
