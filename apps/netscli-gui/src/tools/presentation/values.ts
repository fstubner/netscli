export function emptyToUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function numberOrUndefined(value?: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A cell a spreadsheet will treat as text, never as a formula.
 *
 * Exported rows carry values the scanned host chose -- banners, hostnames,
 * service strings. Excel and LibreOffice evaluate any cell opening with
 * `=`, `+`, `-` or `@`, so a host answering with `=HYPERLINK("http://…")`
 * gets a live link in the operator's spreadsheet. Prefixing a single quote
 * is the standard defence: spreadsheets read it as "this is text" and do
 * not display it, and any other CSV reader sees one leading quote rather
 * than a formula.
 *
 * `\r` and tab are in the trigger set because both can carry a value onto a
 * fresh line or cell where it would lead again.
 */
export function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  // A cell that parses as a number cannot be a formula, so latency of -1 or
  // a `+`-signed figure stays a number rather than gaining a stray quote.
  const numeric = text !== '' && Number.isFinite(Number(text));
  const guarded = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n') || guarded.includes('\r')) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** One decimal for fractions, none for whole numbers.
 *
 * Was copied verbatim into rows.ts, summaries.ts and traceLine.ts. Three
 * identical private copies of a formatting rule is three places to change
 * when the rule changes, and nothing to make them change together. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
