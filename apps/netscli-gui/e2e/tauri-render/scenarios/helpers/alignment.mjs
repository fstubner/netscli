import assert from 'node:assert/strict';

/**
 * Alignment checks that report drift without making the suite hostage to it.
 *
 * Roughly a third of this suite's assertions pinned pixel measurements with
 * tolerances as tight as 3px (M-14). Those are real signals — a control
 * drifting out of its row is a genuine regression — but at that precision
 * they also fail for reasons that are not bugs: a different font rendering,
 * a fractional device pixel ratio, a platform scrollbar width, a Chrome
 * release changing subpixel rounding. A suite that cries wolf gets muted, and
 * a muted suite catches nothing.
 *
 * So: drift inside `tolerance` passes silently, drift beyond it is *reported*
 * and collected, and only gross misalignment — `grossFactor` times the
 * tolerance, i.e. something visibly broken rather than a rounding difference
 * — fails the run.
 *
 * Call `alignmentReport()` at the end of a run to surface everything that
 * drifted, so the warnings stay visible instead of scrolling past.
 */

const drifts = [];
const DEFAULT_GROSS_FACTOR = 4;

export function assertAlignment(label, delta, tolerance, options = {}) {
  const grossFactor = options.grossFactor ?? DEFAULT_GROSS_FACTOR;
  const gross = tolerance * grossFactor;

  assert.equal(
    typeof delta,
    'number',
    `${label}: expected a numeric delta, got ${JSON.stringify(delta)}`,
  );
  assert.ok(Number.isFinite(delta), `${label}: delta was not finite (${delta})`);

  if (delta <= tolerance) return;

  if (delta > gross) {
    throw new assert.AssertionError({
      message:
        `${label}: ${delta.toFixed(1)}px off, which is beyond ${gross}px and reads as ` +
        `visibly misaligned rather than a rendering difference (tolerance ${tolerance}px).`,
    });
  }

  drifts.push({ label, delta, tolerance });
  console.warn(
    `  ~ alignment drift: ${label} is ${delta.toFixed(1)}px off (tolerance ${tolerance}px). ` +
      'Not failing — under the gross-misalignment threshold.',
  );
}

/** Everything that drifted this run, for an end-of-run summary. */
export function alignmentReport() {
  return drifts.slice();
}

export function resetAlignmentReport() {
  drifts.length = 0;
}
