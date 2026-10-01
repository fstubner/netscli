import { calibrateEmbeddingDevice, deviceCandidates, readDeviceVerdict } from "../handoff/device.js";
import { ENABLE_SEMANTIC_HINT, isRuntimeInstalled } from "../handoff/embedding-runtime.js";

interface CalibrateOptions {
  /** Re-measure even when a verdict for this machine is already cached. */
  force?: boolean;
}

/**
 * Time the embedding model on every execution provider this machine offers,
 * and remember the fastest.
 *
 * Nobody needs to run this. Both automatic paths cover it: `xtctx scan
 * --embed` calibrates before a long embed, and the MCP server calibrates at
 * start on a machine with no verdict, deferring the model's first load until
 * the result is in so it applies in the same session (`runtime/background.ts`).
 *
 * It stays as a command for the two things automation cannot do: `--force`
 * after the hardware changes, and showing the measurements to someone who
 * wants to see them. It is not a step in getting set up, and nothing should
 * tell a user it is.
 *
 * Still never behind an agent's tool call. That line is about where the cost
 * lands, not about whether it is automatic: both automatic callers are
 * background work that was already going to take minutes.
 */
export async function runCalibrate(options: CalibrateOptions = {}): Promise<void> {
  // Asked for directly, so this says why nothing happened rather than
  // silently doing nothing — unlike the automatic path in `scan --embed`.
  if (process.env.XTCTX_DISABLE_EMBEDDINGS === "1") {
    process.stdout.write(
      "XTCTX_DISABLE_EMBEDDINGS=1 is set, so there is no model to time. Unset it and run this again.\n",
    );
    return;
  }

  // Nothing to time without the local model, and timing it is what loads it.
  if (!isRuntimeInstalled()) {
    process.stdout.write(
      `Local semantic search is not enabled, so there is no model to time. To turn it on, ${ENABLE_SEMANTIC_HINT}, then run this again.\n`,
    );
    return;
  }

  const existing = await readDeviceVerdict();
  if (existing && !options.force) {
    process.stdout.write(
      `Already calibrated on ${existing.measuredAt}: ${existing.device}\n` +
        `${formatMeasurements(existing.measured)}\n` +
        `Re-run with --force to measure again.\n`,
    );
    return;
  }

  process.stdout.write(
    `Timing the embedding model on: ${deviceCandidates().join(", ")}\n` +
      "Each runs in its own process and loads the model once, so this takes a minute.\n\n",
  );

  const verdict = await calibrateEmbeddingDevice({
    onProgress: (device) => process.stdout.write(`  ${device}...\n`),
  });

  process.stdout.write(`\n${formatMeasurements(verdict.measured)}\n`);
  if (verdict.device === "cpu") {
    // Said plainly, because "no GPU was used" is a result and not a failure —
    // and on a machine with no GPU it is the correct one.
    process.stdout.write("Chose cpu: nothing else was decisively faster here.\n");
    return;
  }
  process.stdout.write(`Chose ${verdict.device}. Indexing will use it from now on.\n`);
}

function formatMeasurements(measured: Awaited<ReturnType<typeof calibrateEmbeddingDevice>>["measured"]): string {
  return measured
    .map((row) =>
      row.msPerSegment === null
        ? `  ${row.device.padEnd(7)} unavailable — ${truncate(row.error ?? "unknown")}`
        : `  ${row.device.padEnd(7)} ${row.msPerSegment} ms/segment`,
    )
    .join("\n");
}

function truncate(message: string): string {
  // Device initialisation failures carry multi-line native stack text.
  const firstLine = message.split("\n")[0].trim();
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine;
}
