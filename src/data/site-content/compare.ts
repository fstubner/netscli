import type { ComparisonColumn, ComparisonRow, SectionCopy } from './types';

// The competitor comparison matrix. Sample content, like every other file in
// this directory, and check-content.mjs fails the build while REPLACE_ME is
// still here.
//
// Two things are worth knowing before filling it in.
//
// Every cell is a claim about someone else's product, so every cell needs
// checking against that product rather than against its reputation. Say when
// the table was last checked, because a matrix with no date is read as current
// forever. Out-of-the-box defaults are the fair comparison, since a row that
// silently assumes a competitor's optional flag is a row that is wrong for
// most of its readers.
//
// Rows where the answer is genuinely mixed get a short phrase rather than a
// tick. A cell reduced to a dash when the truth was 'yes, behind a flag' is
// the kind of error a reader checks once and then stops trusting the whole
// table for.
export const compareCopy: SectionCopy = {
  heading: 'How REPLACE_ME compares',
  leadHtml:
    'Against the tools it replaces. Out-of-the-box defaults, at the time of writing.',
};

// Column order is the cell order in every row below. The highlighted column is
// this product, and it gets the accent outline.
export const compareColumns: ComparisonColumn[] = [
  { name: 'REPLACE_ME', highlight: true },
  { name: 'Alternative one' },
  { name: 'Alternative two' },
  { name: 'Alternative three' },
];

export const compareRows: ComparisonRow[] = [
  { feature: 'Windows / macOS / Linux', cells: ['✓', '✓', 'macOS, Linux', '✓'] },
  { feature: 'Single static binary', cells: ['✓ Go', '✓ Rust', 'shell script', '✓ Rust'] },
  { feature: 'A capability you have', cells: ['✓', '—', '—', '—'] },
  { feature: 'A capability you partly have', cells: ['behind a flag', '✓', '—', '—'] },
  { feature: 'A capability you do not have', cells: ['—', '—', '—', '✓'] },
];

/** Shown under the table. The place to record what a cell is glossing over,
 *  and the honest note about where this product stops. A matrix with no such
 *  line reads as marketing. */
export const compareNoteHtml =
  'REPLACE_ME: say here what the table cannot fit, and name the row where this product is the weaker choice.';
