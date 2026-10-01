/**
 * Time one embedding device, in a process of its own, and print the result.
 *
 * Spawned by `calibrateEmbeddingDevice`. It is a separate process because two
 * providers in one process fail intermittently with `bad allocation`, and a
 * device that cannot initialise has to be a measurement rather than a crash in
 * the caller.
 *
 * Spawned by path, so it has to exist wherever it is spawned from: `tsc`
 * emits it to `dist/src/handoff/device-worker.js` for the published package,
 * and `workerArgv` in device.ts spawns the `.ts` through tsx when running from
 * source. A plain `.js` file here would be simpler to spawn and would never
 * reach `dist` at all, because the build is `tsc` over the `src` tree and
 * copies nothing.
 */
import { parseArgs } from "node:util";
import { DEFAULT_EMBEDDING_DTYPE, DEFAULT_EMBEDDING_MODEL } from "./embeddings.js";
import { calibrationSegments } from "./device.js";
import { importTransformers } from "./embedding-runtime.js";

const { values } = parseArgs({
  options: {
    device: { type: "string", default: "cpu" },
    segments: { type: "string", default: "16" },
  },
  strict: false,
});

/**
 * Timed passes per device; the fastest is reported.
 *
 * Three, because the model load dominates this process's cost and two extra
 * passes over sixteen segments are cheap next to it.
 */
const PASSES = 3;

const device = values.device;
const segmentCount = Math.max(1, Number.parseInt(String(values.segments), 10) || 16);

try {
  const segments = calibrationSegments(segmentCount);
  const transformers = (await importTransformers()) as {
    pipeline: (
      task: "feature-extraction",
      model: string,
      options: Record<string, unknown>,
    ) => Promise<
      (
        input: string[],
        options: { pooling: "mean"; normalize: boolean },
      ) => Promise<{ data: ArrayLike<number> }>
    >;
  };
  const options: Record<string, unknown> = { dtype: DEFAULT_EMBEDDING_DTYPE, device };
  const extractor = await transformers.pipeline(
    "feature-extraction",
    DEFAULT_EMBEDDING_MODEL,
    options,
  );

  // One full untimed pass first, not a token batch of two.
  //
  // The first call carries graph compilation and buffer allocation, which is a
  // one-off cost rather than throughput — and on the GPU paths it is large
  // enough to invert the ranking. Measured on this desktop with a 2-segment
  // warmup: dml 6.0ms and webgpu 10.1ms per segment, so DirectML won. With a
  // full warmup: dml 4.6 and webgpu 3.4, so WebGPU wins. The short warmup was
  // not measuring a slower device, it was measuring a device still starting up.
  await extractor(segments, { pooling: "mean", normalize: true });

  // Best of several passes, not one.
  //
  // The noise being removed is other load on the machine: a browser, a build,
  // another agent. That only ever makes a pass SLOWER, so the minimum is the
  // closest this gets to the device's real throughput, and taking it is what
  // lets the caller compare devices on a small margin instead of needing a
  // large one to be sure the gap is not someone else's CPU time.
  //
  // Repeats happen here rather than by spawning again because the model is
  // already loaded: a second pass costs a second pass, not another load.
  let best = Number.POSITIVE_INFINITY;
  for (let pass = 0; pass < PASSES; pass += 1) {
    const startedAt = performance.now();
    await extractor(segments, { pooling: "mean", normalize: true });
    best = Math.min(best, performance.now() - startedAt);
  }

  process.stdout.write(
    `\n__XTCTX_DEVICE__${JSON.stringify({
      device,
      msPerSegment: Number((best / segments.length).toFixed(1)),
      passes: PASSES,
    })}\n`,
  );
} catch (error) {
  // A device that cannot initialise is the answer, not a failure: "webgpu is
  // unavailable here" is exactly what the caller needs in order to rule it out.
  process.stdout.write(
    `\n__XTCTX_DEVICE__${JSON.stringify({
      device,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
}
