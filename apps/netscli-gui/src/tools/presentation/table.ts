import type { ResultColumn, ResultRow, WorkspaceTab } from '../types';
import { csvEscape } from './values';

export function filterAndSortRows(rows: ResultRow[], tab: WorkspaceTab, filterText: string): ResultRow[] {
  const tokens = parseFilter(filterText);
  const filtered = tokens.length > 0 ? rows.filter((row) => matchesFilter(row, tokens)) : rows;

  return [...filtered].sort((a, b) => {
    const left = a.data[tab.sortKey] ?? '';
    const right = b.data[tab.sortKey] ?? '';
    const leftNum = typeof left === 'number' ? left : Number(left);
    const rightNum = typeof right === 'number' ? right : Number(right);
    const cmp =
      Number.isFinite(leftNum) && Number.isFinite(rightNum)
        ? leftNum - rightNum
        : String(left).localeCompare(String(right), undefined, { numeric: true });
    return tab.sortDir === 'desc' ? -cmp : cmp;
  });
}

export function serializeRowsAsCsv(columns: ResultColumn[], rows: ResultRow[]): string {
  const csvRows = [
    columns.map((column) => csvEscape(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row.data[column.key])).join(',')),
  ];
  return csvRows.join('\n');
}

interface FilterToken {
  key?: string;
  value: string;
  negate: boolean;
}

const FIELD_ALIASES: Record<string, string[]> = {
  address: ['ips'],
  addresses: ['ips'],
  dns: ['record_type'],
  host: ['ip'],
  interface: ['interface', 'name'],
  record: ['record_type'],
  type: ['record_type'],
};

function parseFilter(input: string): FilterToken[] {
  const query = input.trim();
  if (!query) return [];

  const matches = tokenizeFilter(query);
  return matches
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const negate = raw.startsWith('!') || raw.startsWith('-');
      const token = stripQuotes(negate ? raw.slice(1) : raw);
      const splitIndex = token.indexOf(':');
      if (splitIndex <= 0) {
        return { value: token.toLowerCase(), negate };
      }
      return {
        key: normalizeFieldKey(token.slice(0, splitIndex)),
        value: stripQuotes(token.slice(splitIndex + 1)).toLowerCase(),
        negate,
      };
    })
    .filter((token) => token.value.length > 0);
}

function tokenizeFilter(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const char of query) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function matchesFilter(row: ResultRow, tokens: FilterToken[]): boolean {
  return tokens.every((token) => {
    const matched = token.key
      ? keysFor(token.key).some((key) => cellText(row.data[key]).includes(token.value))
      : row.searchText.includes(token.value);
    return token.negate ? !matched : matched;
  });
}

function normalizeFieldKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-\s]/g, '_');
}

function keysFor(key: string): string[] {
  return FIELD_ALIASES[key] ?? [key];
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function cellText(value: unknown): string {
  return value == null ? '' : String(value).toLowerCase();
}
