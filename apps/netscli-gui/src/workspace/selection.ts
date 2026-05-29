export function clampIndex(index: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.min(Math.max(index, 0), rowCount - 1);
}

export function normalizeSelection(
  indices: number[] | undefined,
  selectedIndex: number | undefined,
  rowCount: number,
): number[] {
  if (rowCount <= 0) return [];
  const valid = Array.from(
    new Set((indices ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < rowCount)),
  ).sort((left, right) => left - right);
  if (valid.length > 0) return valid;
  return [clampIndex(selectedIndex ?? 0, rowCount)];
}

export function rangeBetween(start: number, end: number): number[] {
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return Array.from({ length: high - low + 1 }, (_item, offset) => low + offset);
}

