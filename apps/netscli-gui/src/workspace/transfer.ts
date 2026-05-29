import type { ResultColumn, ResultRow, WorkspaceTab } from '../tools/types';
import { serializeRowsAsCsv } from '../tools/presentation';
import { downloadText } from './toolExecution';

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

export async function copyRowsDetails(rows: ResultRow[]) {
  if (rows.length === 0) return;
  const details = rows
    .map((row, index) => {
      const body = Object.entries(row.data)
        .map(([key, value]) => `${key}: ${value ?? ''}`)
        .join('\n');
      return rows.length === 1 ? body : `Row ${index + 1}\n${body}`;
    })
    .join('\n\n');
  await navigator.clipboard?.writeText(details).catch(() => undefined);
}

export async function copyRowsRaw(rows: ResultRow[]) {
  if (rows.length === 0) return;
  const payload = rows.length === 1 ? rows[0].raw : rows.map((row) => row.raw);
  await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
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

