import { describe, expect, it } from 'vitest';

import fixture from '../../../../testdata/csv-escape.json';
import { csvEscape } from './presentation';

// The cases the CLI's `--csv` is tested against too (testdata/csv-escape.json),
// so the two CSV exports quote and defuse a cell the same way.
describe('csvEscape against the shared cases', () => {
  for (const { in: input, out } of fixture.cases) {
    it(`escapes ${JSON.stringify(input)}`, () => {
      expect(csvEscape(input)).toBe(out);
    });
  }
});
