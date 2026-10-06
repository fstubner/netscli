import { describe, expect, it } from 'vitest';

import { OVERSCAN, rowWindow, scrollTopToShow, WINDOW_THRESHOLD } from './rowWindow';

describe('rowWindow', () => {
  it('renders a small result whole', () => {
    expect(rowWindow(WINDOW_THRESHOLD, 5000, 600, 31)).toEqual({
      start: 0,
      end: WINDOW_THRESHOLD,
      before: 0,
      after: 0,
    });
  });

  it('renders only the rows in view plus the margin for a large result', () => {
    const w = rowWindow(4096, 31 * 1000, 620, 31);
    // Row 1000 is at the top of the view, 21 rows fit.
    expect(w.start).toBe(1000 - OVERSCAN);
    expect(w.end).toBe(1000 + 21 + OVERSCAN);
    expect(w.end - w.start).toBeLessThan(80);
    // The spacers keep the scrollbar the size of the whole result.
    expect(w.before + (w.end - w.start) * 31 + w.after).toBe(4096 * 31);
  });

  it('clamps at both ends', () => {
    expect(rowWindow(4096, 0, 620, 31).start).toBe(0);
    const last = rowWindow(4096, 31 * 4096, 620, 31);
    expect(last.end).toBe(4096);
    expect(last.after).toBe(0);
  });
});

describe('scrollTopToShow', () => {
  it('leaves a visible row alone', () => {
    expect(scrollTopToShow(10, 0, 620, 31, 31)).toBeNull();
  });

  it('scrolls up to a row above the view', () => {
    expect(scrollTopToShow(5, 31 * 100, 620, 31, 31)).toBe(31 * 5);
  });

  it('scrolls down so a row below the view sits just above the bottom edge', () => {
    // 589 px of body under a 31 px header; row 50 ends at 1581 px.
    expect(scrollTopToShow(50, 0, 620, 31, 31)).toBe(31 * 51 - (620 - 31));
  });
});
