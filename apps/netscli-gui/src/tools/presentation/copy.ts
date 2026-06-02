import type { ResultCellContext, ResultColumn, ResultRow } from '../types';
import { renderValue } from './values';

export function copyContextForCell(row: ResultRow, column: ResultColumn): ResultCellContext | null {
  const value = row.data[column.key];
  if (value === null || value === undefined || value === '') return null;
  return {
    columnKey: column.key,
    label: column.label,
    value: renderValue(value),
    row: {
      id: row.id,
      kind: row.kind,
      data: row.data,
    },
  };
}
