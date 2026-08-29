// The index maths behind live tab reordering.
//
// Live reordering feeds its own output back in, so the failure mode is not a
// wrong answer once — it is a tab that flickers between two slots for as long
// as you hold it. The case that matters is therefore "run it again on the
// geometry the last move produced and get the same answer".

import { describe, expect, it } from 'vitest';

import { tabDropIndex, type TabBox } from './tabDropIndex';

/** Three 100px tabs at x = 0, 100, 200. Midpoints at 50, 150, 250. */
const even: TabBox[] = [
  { left: 0, width: 100 },
  { left: 100, width: 100 },
  { left: 200, width: 100 },
];

describe('tabDropIndex', () => {
  it('keeps a tab where it is while the pointer stays in its own slot', () => {
    expect(tabDropIndex(even, 0, 10)).toBe(0);
    expect(tabDropIndex(even, 1, 120)).toBe(1);
    expect(tabDropIndex(even, 2, 260)).toBe(2);
  });

  it('moves right once the pointer passes the next tab\u2019s midpoint', () => {
    // Dragging tab 0: tab 1's midpoint is 150.
    expect(tabDropIndex(even, 0, 149)).toBe(0);
    expect(tabDropIndex(even, 0, 151)).toBe(1);
    expect(tabDropIndex(even, 0, 260)).toBe(2);
  });

  it('moves left once the pointer passes back over a midpoint', () => {
    expect(tabDropIndex(even, 2, 151)).toBe(2);
    expect(tabDropIndex(even, 2, 149)).toBe(1);
    expect(tabDropIndex(even, 2, 40)).toBe(0);
  });

  // The whole reason this function ignores the dragged tab.
  it('is stable when re-run on the geometry its own move produced', () => {
    // Drag tab 0 right; after the move it occupies slot 1 and the tab that
    // was there is now slot 0. Same pointer position, same widths.
    const afterMove: TabBox[] = [
      { left: 0, width: 100 },
      { left: 100, width: 100 },
      { left: 200, width: 100 },
    ];
    const pointer = 151;
    expect(tabDropIndex(even, 0, pointer)).toBe(1);
    // Re-running with the dragged tab now AT index 1 must not send it back.
    expect(tabDropIndex(afterMove, 1, pointer)).toBe(1);
  });

  // Tabs are sized by their labels, so unequal widths are the normal case.
  it('handles tabs of different widths', () => {
    const uneven: TabBox[] = [
      { left: 0, width: 60 },    // midpoint 30
      { left: 60, width: 200 },  // midpoint 160
      { left: 260, width: 80 },  // midpoint 300
    ];
    expect(tabDropIndex(uneven, 0, 100)).toBe(0);
    expect(tabDropIndex(uneven, 0, 170)).toBe(1);
    expect(tabDropIndex(uneven, 0, 310)).toBe(2);
  });

  it('clamps to the ends rather than running off them', () => {
    expect(tabDropIndex(even, 0, -500)).toBe(0);
    expect(tabDropIndex(even, 0, 5000)).toBe(2);
  });

  it('reports nothing for an empty strip or an index off the end', () => {
    expect(tabDropIndex([], 0, 10)).toBe(-1);
    expect(tabDropIndex(even, 7, 10)).toBe(-1);
    expect(tabDropIndex(even, -1, 10)).toBe(-1);
  });
});
