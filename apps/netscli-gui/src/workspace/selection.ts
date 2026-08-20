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

/**
 * Find a row's position in the list a tab is actually rendering.
 *
 * Positions are only meaningful against one specific ordering. Workspace
 * search enumerates rows in backend order and the table renders them sorted
 * and filtered, so an index taken from one and applied to the other agreed
 * only when no sort and no filter were in play -- which is never, since
 * every tool kind has a DEFAULT_SORT. Row ids survive both operations, so
 * they are what should cross the boundary.
 */
export function indexOfRowId(rows: { id: string }[], rowId: string): number {
  return rows.findIndex((row) => row.id === rowId);
}

