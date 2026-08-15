import { describe, expect, it } from 'vitest';

import { countList } from './OperationProgress';

// C-16: the progress line reported "1 ports" for a full 1-1024 sweep, because
// the count split on `,` only and never expanded a range.
describe('port count in the progress line', () => {
  it('counts comma-separated singles', () => {
    expect(countList('22,80,443')).toBe(3);
  });

  it('expands a range instead of counting it as one', () => {
    expect(countList('1-1024')).toBe(1024);
    expect(countList('80-80')).toBe(1);
  });

  it('handles ranges mixed with singles', () => {
    expect(countList('22,80-89,443')).toBe(12);
  });

  it('tolerates whitespace around a range', () => {
    expect(countList('1 - 3')).toBe(3);
  });

  it('ignores a reversed range rather than going negative', () => {
    // A negative contribution would make the total smaller than the singles
    // beside it, which reads as nonsense in the UI.
    expect(countList('100-1')).toBe(0);
    expect(countList('22,100-1,443')).toBe(2);
  });

  it('returns 0 for empty or undefined input', () => {
    expect(countList(undefined)).toBe(0);
    expect(countList('')).toBe(0);
    expect(countList('  ')).toBe(0);
  });

  it('counts a non-numeric token as one entry rather than dropping it', () => {
    expect(countList('http')).toBe(1);
  });
});
