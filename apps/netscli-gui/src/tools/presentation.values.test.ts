import { describe, expect, it } from 'vitest';

import { csvEscape, serializeRowsAsCsv } from './presentation';
import type { ResultColumn } from './types';

// Split out of presentation.test.ts, which was at its size cap with a note
// asking for exactly this: one file per helper family. These cover the
// value-and-serialisation helpers rather than row or column building.
describe('cell values and CSV serialisation', () => {
  // Exported cells carry values the scanned host chose. Excel and
  // LibreOffice evaluate a cell opening with = + - or @, so a banner of
  // `=HYPERLINK(...)` became a live link in the operator's spreadsheet.
  it('neutralises spreadsheet formulas in exported cells', () => {
    // Commas and quotes inside the formula still get CSV-quoted around the
    // leading apostrophe, so both defences apply at once.
    expect(csvEscape('=HYPERLINK("http://evil.test","click")')).toBe(
      `"'=HYPERLINK(""http://evil.test"",""click"")"`,
    );
    expect(csvEscape('@SUM(A1:A9)')).toBe(`'@SUM(A1:A9)`);
    expect(csvEscape(`-2+3+cmd|' /C calc'!A0`)).toBe(`'-2+3+cmd|' /C calc'!A0`);

    // A number is not a formula, and must not pick up a quote.
    expect(csvEscape(-1)).toBe('-1');
    expect(csvEscape('+80')).toBe('+80');
    expect(csvEscape('nginx/1.25.3')).toBe('nginx/1.25.3');
  });

  it('escapes CSV output', () => {
    expect(csvEscape('a,b"c\n')).toBe('"a,b""c\n"');

    const columns: ResultColumn[] = [
      { key: 'name', label: 'Name' },
      { key: 'value', label: 'Value' },
    ];
    const csv = serializeRowsAsCsv(columns, [
      {
        id: 'row-1',
        kind: 'dns',
        data: { name: 'txt', value: 'hello, "world"' },
        raw: {},
        searchText: '',
      },
    ]);
    expect(csv).toBe('Name,Value\ntxt,"hello, ""world"""');
  });
});
