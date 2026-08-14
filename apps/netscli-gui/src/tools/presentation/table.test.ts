import { describe, expect, it } from 'vitest';

import { filterAndSortRows } from './table';
import type { ResultRow, WorkspaceTab } from '../types';

// Minimal rows: `filterAndSortRows` matches unkeyed terms against
// `searchText` and keyed terms against `data`.
const ROWS: ResultRow[] = [
  { data: { port: 22, service: 'ssh', status: 'open' }, searchText: '22 ssh open', raw: {} },
  { data: { port: 80, service: 'nginx', status: 'open' }, searchText: '80 nginx open', raw: {} },
  { data: { port: 443, service: 'nginx', status: 'open' }, searchText: '443 nginx open', raw: {} },
  { data: { port: 8080, service: 'proxy', status: 'closed' }, searchText: '8080 proxy closed', raw: {} },
] as unknown as ResultRow[];

const TAB = { kind: 'scan', sortKey: undefined, sortDir: 'asc' } as unknown as WorkspaceTab;

const filter = (query: string) => filterAndSortRows(ROWS, TAB, query);

describe('result filter quoting', () => {
  it('matches an unquoted term', () => {
    expect(filter('open')).toHaveLength(3);
  });

  it('matches a fully quoted term with either quote style', () => {
    expect(filter('"open"')).toHaveLength(3);
    expect(filter("'open'")).toHaveLength(3);
  });

  // M-6. Typing `"open"` passes through `"open` on the way. That intermediate
  // state used to tokenize as the literal `"open`, which matched nothing — so
  // the table blinked to empty mid-keystroke and stayed there if the user
  // never closed the quote.
  //
  // Reproduced live before the fix: open -> 4 rows, 'open' -> 4, 'open -> 0.
  it('treats an unterminated quote as if it had not been typed yet', () => {
    expect(filter('"open')).toHaveLength(3);
    expect(filter("'open")).toHaveLength(3);
  });

  it('still splits terms while a quote is dangling', () => {
    // `"nginx open` must behave as two terms, not one literal phrase.
    expect(filter('"nginx open')).toHaveLength(2);
  });

  it('keeps a closing quote from swallowing the term', () => {
    expect(filter('open"')).toHaveLength(3);
  });

  it('does not treat a mid-word apostrophe as a quote', () => {
    // A lone apostrophe inside a word must stay part of the search text,
    // otherwise names like o'brien become unsearchable.
    expect(filter("don't")).toHaveLength(0);
    expect(filter('nginx')).toHaveLength(2);
  });

  it('ignores a lone quote character rather than matching nothing', () => {
    expect(filter('"')).toHaveLength(ROWS.length);
    expect(filter("'")).toHaveLength(ROWS.length);
  });

  it('supports quoted phrases containing spaces', () => {
    // A quoted phrase is one contiguous substring match against searchText.
    expect(filter('"nginx open"')).toHaveLength(2);
    expect(filter('"443 nginx"')).toHaveLength(1);
    // Non-adjacent words do not match as a phrase, unlike two bare terms.
    expect(filter('"open 443"')).toHaveLength(0);
    expect(filter('open 443')).toHaveLength(1);
  });
});
