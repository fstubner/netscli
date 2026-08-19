import type { ToolKind, ResultColumn, ResultRow, WorkspaceTab } from '../tools/types';
import type { ToolResult } from '../types/app';
import { serializeRowsAsCsv } from '../tools/presentation';
import { TOOL_KINDS } from '../tools/registry';
import { downloadText } from './toolExecution';

export const RESULT_BUNDLE_SCHEMA = 'netscli.result.v1';

export interface ResultBundle {
  schema: typeof RESULT_BUNDLE_SCHEMA;
  exportedAt: string;
  title: string;
  command: string;
  kind: ToolKind;
  form: Record<string, string>;
  result: ToolResult;
}

export function exportCurrentResult(
  activeTab: WorkspaceTab | undefined,
  columns: ResultColumn[],
  rows: ResultRow[],
  format: 'json' | 'csv',
  onSuccess: (path: string | null | undefined, fallback: string) => void,
  onError: (error: unknown) => void,
) {
  if (!activeTab?.result) return;
  const stamp = Date.now();
  if (format === 'json') {
    exportText(
      `netscli-${activeTab.kind}-${stamp}.json`,
      'application/json',
      JSON.stringify(activeTab.result.data, null, 2),
      'Exported JSON',
      onSuccess,
      onError,
    );
    return;
  }

  exportText(
    `netscli-${activeTab.kind}-${stamp}.csv`,
    'text/csv',
    serializeRowsAsCsv(columns, rows),
    'Exported CSV',
    onSuccess,
    onError,
  );
}

export function buildResultBundle(activeTab: WorkspaceTab, command: string): ResultBundle | null {
  if (!activeTab.result) return null;
  return {
    schema: RESULT_BUNDLE_SCHEMA,
    exportedAt: new Date().toISOString(),
    title: activeTab.title,
    command,
    kind: activeTab.kind,
    form: { ...activeTab.form },
    result: activeTab.result,
  };
}

export function parseResultBundle(value: unknown): ResultBundle {
  if (!value || typeof value !== 'object') {
    throw new Error('Result bundle must be a JSON object');
  }
  const bundle = value as Partial<ResultBundle>;
  if (bundle.schema !== RESULT_BUNDLE_SCHEMA) {
    throw new Error('Unsupported result bundle schema');
  }
  if (!bundle.kind || typeof bundle.kind !== 'string') {
    throw new Error('Result bundle is missing a tool kind');
  }
  if (!isToolKind(bundle.kind)) {
    throw new Error(`Unsupported result bundle tool kind: ${bundle.kind}`);
  }
  if (!bundle.result || typeof bundle.result !== 'object') {
    throw new Error('Result bundle is missing result data');
  }
  const result = bundle.result as { kind?: unknown; data?: unknown };
  if (result.kind !== bundle.kind) {
    throw new Error('Result bundle kind does not match its result payload');
  }
  validateResultDataShape(bundle.kind, result.data);
  return {
    schema: RESULT_BUNDLE_SCHEMA,
    exportedAt: typeof bundle.exportedAt === 'string' ? bundle.exportedAt : new Date().toISOString(),
    title: typeof bundle.title === 'string' ? bundle.title : bundle.kind,
    command: typeof bundle.command === 'string' ? bundle.command : '',
    kind: bundle.kind,
    form: isStringRecord(bundle.form) ? bundle.form : {},
    result: bundle.result as ToolResult,
  };
}

export function exportSelectedRows(
  activeTab: WorkspaceTab | undefined,
  columns: ResultColumn[],
  selectedRows: ResultRow[],
  format: 'json' | 'csv',
  onSuccess: (path: string | null | undefined, fallback: string) => void,
  onError: (error: unknown) => void,
) {
  if (!activeTab || selectedRows.length === 0) return;
  const stamp = Date.now();
  const fallback = selectedRows.length === 1 ? 'Exported selected row' : `Exported ${selectedRows.length} selected rows`;
  if (format === 'json') {
    const payload = selectedRows.length === 1 ? selectedRows[0].raw : selectedRows.map((row) => row.raw);
    exportText(
      `netscli-${activeTab.kind}-selected-${stamp}.json`,
      'application/json',
      JSON.stringify(payload, null, 2),
      fallback,
      onSuccess,
      onError,
    );
    return;
  }

  exportText(
    `netscli-${activeTab.kind}-selected-${stamp}.csv`,
    'text/csv',
    serializeRowsAsCsv(columns, selectedRows),
    fallback,
    onSuccess,
    onError,
  );
}

// These build the text and nothing more. They used to write to the clipboard
// themselves and swallow the outcome, which left the caller reporting success
// unconditionally (B-19). Copy reporting now lives in one place, in
// `useResultActions.copyToClipboard`.

export function formatRowsDetails(rows: ResultRow[]): string {
  return rows
    .map((row, index) => {
      const body = Object.entries(row.data)
        .map(([key, value]) => `${key}: ${value ?? ''}`)
        .join('\n');
      return rows.length === 1 ? body : `Row ${index + 1}\n${body}`;
    })
    .join('\n\n');
}

export function formatRowsRaw(rows: ResultRow[]): string {
  const payload = rows.length === 1 ? rows[0].raw : rows.map((row) => row.raw);
  return JSON.stringify(payload, null, 2);
}

function exportText(
  filename: string,
  mime: string,
  content: string,
  fallback: string,
  onSuccess: (path: string | null | undefined, fallback: string) => void,
  onError: (error: unknown) => void,
) {
  void downloadText(filename, mime, content)
    .then((path) => onSuccess(path, fallback))
    .catch(onError);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function isToolKind(value: string): value is ToolKind {
  return (TOOL_KINDS as readonly string[]).includes(value);
}

function validateResultDataShape(kind: ToolKind, data: unknown) {
  if (
    kind === 'scan' ||
    kind === 'discover' ||
    kind === 'dns' ||
    kind === 'sweep' ||
    kind === 'mdns' ||
    kind === 'interfaces' ||
    kind === 'arp'
  ) {
    if (!Array.isArray(data)) {
      throw new Error(`Result bundle data for ${kind} must be an array`);
    }
    // "Is an array" was the whole check, so `[null]` imported cleanly and
    // then threw inside `buildRows` during render -- past every catch, in a
    // `useMemo`. Row builders read fields off each entry, so an entry that
    // is not an object cannot be one of these rows.
    const bad = data.findIndex((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry));
    if (bad !== -1) {
      throw new Error(`Result bundle data for ${kind} has a non-object entry at index ${bad}`);
    }
    return;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Result bundle data for ${kind} must be an object`);
  }

  if (kind === 'trace' && !Array.isArray((data as { lines?: unknown }).lines)) {
    throw new Error('Result bundle trace data must include lines');
  }
  if (kind === 'pcap' && !Array.isArray((data as { packets?: unknown }).packets)) {
    throw new Error('Result bundle pcap data must include packets');
  }
}
