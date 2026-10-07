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
/** A character a CSV cell must not carry as is: a control character other
 *  than the tab, CR and LF a cell can carry, or a bidi or zero-width one that
 *  reorders or hides text. The same set as `is_unsafe_for_display` in
 *  netscli-core (crates/netscli-core/src/common/terminal.rs), which the CLI's
 *  CSV export uses; testdata/csv-escape.json holds both to it. */
function isDefusedControl(char: string): boolean {
  if (char === '\t' || char === '\r' || char === '\n') return false;
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/** A finite decimal number, as Rust's `str::parse::<f64>` accepts it. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function csvEscape(value: unknown): string {
  // Control characters become `.`, as in the CLI's --csv, except tab, CR and
  // LF, which a quoted cell carries and a multi-line banner needs. An escape
  // sequence in a banner would otherwise run in a terminal that prints the
  // file.
  const text = Array.from(String(value ?? ''), (char) => (isDefusedControl(char) ? '.' : char)).join('');
  // A cell that parses as a number cannot be a formula, so latency of -1 or
  // a `+`-signed figure stays a number rather than gaining a stray quote.
  // A decimal literal only, as Rust's f64 parse in the CLI reads it:
  // `Number()` also accepted surrounding whitespace, so a cell of "\t1"
  // counted as a number and skipped the guard the CLI applies.
  const numeric = DECIMAL.test(text);
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
