import type { ToolResult } from '../types/app';
import type { OperationProgressState, WorkspaceTab } from '../tools/types';

export function applyProgressUpdate(tab: WorkspaceTab, progress: OperationProgressState): WorkspaceTab {
  if (tab.kind !== 'trace') {
    return { ...tab, progress };
  }

  const traceLine = traceLineFromProgress(progress.detail);
  if (!traceLine) {
    return { ...tab, progress };
  }

  const existing = tab.result?.kind === 'trace' ? tab.result : null;
  const lines = existing?.data.lines ?? [];
  if (lines.includes(traceLine)) {
    return { ...tab, progress };
  }

  const result: ToolResult = {
    kind: 'trace',
    data: {
      host: existing?.data.host ?? tab.form.host?.trim() ?? '',
      tool: existing?.data.tool ?? 'trace',
      exit_code: existing?.data.exit_code ?? null,
      lines: [...lines, traceLine],
    },
  };
  if (existing?.warnings) result.warnings = existing.warnings;

  return {
    ...tab,
    progress,
    result,
    selectedIndex: tab.result ? tab.selectedIndex : 0,
    selectedIndices: tab.result ? tab.selectedIndices : [0],
  };
}

function traceLineFromProgress(detail: string | null | undefined): string | null {
  const value = detail?.trim();
  if (!value) return null;
  const separator = ' - ';
  const line = value.includes(separator)
    ? value.slice(value.indexOf(separator) + separator.length).trim()
    : value;
  if (!line) return null;
  const firstToken = line.split(/\s+/)[0];
  return /^\d+$/.test(firstToken) ? line : null;
}
