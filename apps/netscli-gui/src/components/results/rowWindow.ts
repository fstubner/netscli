/**
 * Which result rows to put in the DOM.
 *
 * The table rendered every row, and every selection change or scroll
 * re-rendered all of them. Measured on the production build in headless
 * Chrome (2026-10-06): one arrow-key press took a median 107 ms to paint at
 * 4,096 rows (a full port scan) and 620 ms at 20,000 (a packet capture),
 * and switching back to the tab took 0.9 s and 5 s. Rendering only the rows
 * in view, plus a margin, makes that cost independent of the row count.
 *
 * Small results are rendered whole: below the threshold the saving is
 * nothing and every row stays findable with the browser's own search.
 */

export const WINDOW_THRESHOLD = 200;
/** Rows rendered beyond each edge of the viewport, so a fast scroll does not
 *  show blank space before the next render. */
export const OVERSCAN = 20;
/** `.result-table td { height: 30px }` plus the 1px border. Measured from a
 *  rendered row where one exists; this is only the first guess. */
export const DEFAULT_ROW_HEIGHT = 31;

export interface RowWindow {
  start: number;
  end: number;
  /** Height of the empty space standing in for the rows above `start`. */
  before: number;
  /** Height of the empty space standing in for the rows from `end` on. */
  after: number;
}

export function rowWindow(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = OVERSCAN,
): RowWindow {
  if (count <= WINDOW_THRESHOLD || rowHeight <= 0) {
    return { start: 0, end: count, before: 0, after: 0 };
  }
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}

/**
 * Where to scroll so row `index` is fully visible below the sticky header,
 * or `null` if it already is. Needed because a row outside the window is not
 * in the DOM, so `scrollIntoView` has nothing to scroll to.
 */
export function scrollTopToShow(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  headerHeight: number,
): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  const visibleBody = viewportHeight - headerHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + visibleBody) return bottom - visibleBody;
  return null;
}
