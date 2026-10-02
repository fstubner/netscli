import { importTransformers } from "./embedding-runtime.js";

/**
 * The embedding model, chosen on retrieval quality once indexing cost stopped
 * being the binding constraint.
 *
 * bge-small-en-v1.5, at the thresholds on `MIN_SEMANTIC_COSINE` and
 * `MIN_CONFIDENT_COSINE`, against MiniLM at the ones it replaced. Measured
 * 2026-09-21 with `scripts/embedding-bakeoff.ts`, sixty queries, both at a
 * false-positive rate of zero:
 *
 *              hybrid                     vector
 *              mrr    recall@5  top1      mrr    recall@5  top1
 *   MiniLM     0.333  0.533     0.183     0.246  0.350     0.183
 *   bge-small  0.417  0.583     0.267     0.398  0.533     0.317
 *
 * Reproduce either row by running that script; its MiniLM row at 0.15/0.36
 * reproduces `tests/eval/results/ranking-baseline.json` exactly, which is what
 * establishes that it and `ranking.eval.test.ts` measure the same thing.
 *
 * THRESHOLDS DO NOT TRANSFER BETWEEN MODELS, and this is the trap. At MiniLM's
 * 0.15/0.36, bge-small scores a false-positive rate of 1.00 — every
 * deliberately unanswerable query, gibberish included, returns something. It is
 * not the worse model there; it places its cosine values higher, so a floor
 * tuned to MiniLM's distribution excludes nothing. Any future model change has
 * to re-sweep, and the sweep is the whole job.
 *
 * What changed to allow this is cost, not quality. bge-small indexes the eval
 * corpus in 27.5s against MiniLM's 15.6s, about 1.8x, and that ratio is why
 * this was rejected when first measured on 2026-09-20. Device calibration
 * (`device.ts`) then made embedding roughly six times faster on a machine with
 * a GPU, and the MCP server began draining the backlog in the background, so
 * 1.8x of a much smaller number stopped being the deciding term.
 *
 * The caveat the earlier measurement carried still stands: the corpus is
 * synthetic and sixty queries. What is stronger now is that the margin holds
 * across three modes and every threshold pair swept, rather than resting on a
 * single row.
 *
 * Both models are 384 dimensions, so nothing about the schema changes.
 * `dropVectorsFromOtherModels` keys on the model name, so upgrading discards
 * every existing vector and re-embeds — which is the cost of this change and
 * is paid once per project.
 *
 * TWO REJECTIONS WORTH KEEPING, because the arguments for them are strong and
 * the reasons they lose are not obvious.
 *
 * mpnet-q8 was the default for a day, on a table that measured only half the
 * question. What it left out is what embedding actually costs, and the figure
 * used at the time — 18ms per embed — came from benchmarking strings like
 * "warm query number 5". A real segment is 1024 characters, the model's full
 * sequence window, and costs far more. Back to back over 291 real segments
 * from this project's index, mpnet first:
 *
 *   mpnet q8      ~360ms per segment
 *   MiniLM fp32   ~116ms per segment
 *
 * The absolute figures move with what else the process has loaded; the ratio
 * is the durable part, and it favoured MiniLM by three times or better.
 * Measure throughput on real content before moving this again; a per-embed
 * figure taken on short strings says nothing about it.
 *
 * A static model was measured on 2026-09-03 and rejected.
 *
 * Model2Vec statics (`minishlab/potion-base-8M`, 256 dimensions, 30MB) have no
 * transformer forward pass: they look each token's vector up and mean-pool. On
 * 291 real segments from this project's own index, mean 900 characters:
 *
 *   potion-base-8M   1.0ms per segment
 *   MiniLM fp32     71.4ms per segment
 *
 * Seventy times faster, and it loads in about a second rather than minutes on
 * a cold cache — which would remove the warm budget, the vector backlog and
 * the disabled-embeddings switch the test suite needs. It still loses, badly:
 * vector mode fell from mrr 0.246 to 0.016 and recall@5 from 0.350 to 0.033.
 * Hybrid held up at 0.273 only because keyword carries it.
 *
 * Not a threshold artefact — swept at 0.15, 0.25 and 0.45 the vector numbers
 * were identical to three decimals. The cause is length. Mean-pooling every
 * token washes out as text grows, measured on one query against a target and
 * a distractor padded with filler:
 *
 *   margin at ~0 chars     potion 0.714   MiniLM 0.723
 *   margin at ~500 chars   potion 0.148   MiniLM 0.471
 *   margin at ~3000 chars  potion 0.023   MiniLM 0.000
 *
 * Both collapse eventually; potion collapses at the length this project
 * actually embeds. A window here is eight messages.
 *
 * That suggested one more experiment: if length is the problem, the static
 * model should recover at shorter windows, and a 70x cheaper model is exactly
 * what would make short windows affordable. Measured on 2026-09-03, vector
 * mode, same sixty queries:
 *
 *   size/stride   potion   MiniLM
 *   8/4           0.016    0.246
 *   4/2           0.044    0.331
 *   2/1           0.097    0.461
 *
 * The diagnosis holds — potion climbs monotonically as the windows shrink —
 * and the conclusion does not change, because MiniLM climbs faster. The gap
 * widens rather than closes: 0.23 at 8/4, 0.36 at 2/1. There is no window size
 * at which the static model is the better choice here, so this is closed
 * rather than merely deferred.
 *
 * What the control did turn up is about windows, not models: MiniLM at 4/2 and
 * 2/1 is markedly better in `vector` mode than at the current 8/4. That is
 * recorded on `DEFAULT_WINDOW_SIZE`, where the decision belongs.
 */
export const DEFAULT_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";

/**
 * Weight precision to load the model at.
 *
 * fp32 for both MiniLM and bge-small: each is under 140MB at full precision,
 * so quantizing saves little and costs accuracy. The q8 tradeoff only mattered
 * for mpnet, where fp32 was 416MB. Measured on MiniLM, q8 was 16% faster while
 * moving every vector (mean cosine 0.9889 against fp32) — and dtype is not part
 * of the vector identity, so switching it would silently mix two spaces.
 */
export const DEFAULT_EMBEDDING_DTYPE = "fp32";
const MAX_SEQ_TOKENS = 256;
/** ~4 characters per token, the budget splitTextForEmbedding segments to. */
export const MAX_SEQ_CHARS = MAX_SEQ_TOKENS * 4;
/**
 * Segments handed to the model in one forward pass.
 *
 * Sixteen, measured on the real path rather than on a benchmark — and the
 * difference between those two is the whole story here.
 *
 * `scripts/probe-batch-size.mjs` embeds uniform 1000-character segments and
 * said the GPU wanted the largest batch available: 4.0ms/segment at 128
 * against 5.3 at 32, a 1.37x win that reproduced across runs. Acting on it
 * would have been a 5x REGRESSION. Measured instead by running
 * `xtctx scan --embed` over this project's own index from an empty vector
 * table, 150 seconds each on DirectML:
 *
 *   batch      ms/window
 *   8          123.4
 *   16         107.8, 107.9
 *   32         123.4
 *   128        542.9
 *
 * The benchmark's segments were all exactly the same length. Real ones are
 * not — windows hold a median of 4 segments and a 95th percentile of 17, of
 * varying size — and a batch is padded to its longest member, so a wide batch
 * of mixed lengths spends most of its work on padding. Uniform inputs hide
 * the dominant cost of the real workload entirely.
 *
 * This is the same mistake as the "18ms per embed" figure recorded on
 * `DEFAULT_EMBEDDING_MODEL`, which was taken on strings like "warm query
 * number 5" and drove a model change that had to be reverted. Measure this on
 * real content, through the real path, or do not move it.
 *
 * One constant, not one per device. An earlier version of this change made it
 * device-dependent on the strength of the benchmark above; the real-path
 * measurement removed the reason. The independent CPU measurement in
 * `docs/embedding-performance.md` — also taken on real segments from this
 * index — put 16 ahead of 32 by 10-20%, which is the same answer and the same
 * margin as the GPU rows above.
 */
const MAX_BATCH_SIZE = 16;

export interface EmbeddingProvider {
  readonly model: string;
  /**
   * Execution provider this will actually load on, for `xtctx status`.
   *
   * Read off the provider rather than off the calibration cache on purpose.
   * "A verdict was written" and "the indexer is using it" are two different
   * facts, and reporting the first while meaning the second is how a wiring
   * bug hides behind a green check.
   */
  readonly device?: string;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  /**
   * Whether the model is loaded and embedding would start immediately.
   *
   * Loading it means fetching and initialising a local model, which on a cold
   * cache is minutes — not something to do while an agent holds a tool call
   * open. Callers check this to decide whether to answer now by another route.
   */
  isReady?(): boolean;
  /** Begin loading the model without waiting for it. */
  warm?(): void;
  /**
   * Why the last load attempt failed, or undefined if none has.
   *
   * `isReady()` answers "can I embed right now", and a model that is still
   * downloading and a model that cannot download both answer false. Callers
   * that only ask `isReady()` therefore tell the user to wait, forever, for
   * something that is never going to finish — which is exactly what happened:
   * `warm()` is best-effort and swallows its error, so a failed load left
   * hybrid search answering from keyword and reporting "embedding model still
   * loading, ask again shortly" on every call, indefinitely, with nothing in
   * `xtctx status` to say otherwise.
   *
   * Cleared on a successful load, because the failure is worth retrying: a
   * cold cache behind a flaky network fails once and succeeds next time.
   */
  loadError?(): string | undefined;
  /**
   * Set when semantic search is off: no vectors can be built or compared.
   *
   * Search answers from keyword without calling this provider at all, nothing
   * counts as a vectorizing backlog, and vectors already in the index are left
   * alone. They are not "from another model", they are from one that is not
   * switched on. Says why, so `xtctx status` can name the way back.
   */
  readonly semanticOff?: SemanticOffReason;
}

export type SemanticOffReason = "not_enabled" | "disabled_by_env";

type FeatureExtractionOutput = {
  data: Float32Array | Float64Array | number[];
};

type FeatureExtractionPipeline = (
  input: string | string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

export type PipelineFactory = (
  task: "feature-extraction",
  model: string,
  options?: Record<string, unknown>,
) => Promise<FeatureExtractionPipeline>;

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  /**
   * The bare HuggingFace id, which is also the vector identity.
   *
   * `docs/embedding-providers.md` specifies a composite identity and gives
   * `local:Xenova/all-MiniLM-L6-v2` as the local form. Only the remote half of
   * that is implemented, deliberately. The composite exists because two
   * endpoints can both serve `text-embedding-3-small` in different vector
   * spaces, and every remote identity is already `openai:…`-prefixed, so it can
   * never collide with a HuggingFace id. Prefixing the local one collides with
   * nothing either way — while renaming it makes
   * `dropVectorsFromOtherModels` discard every vector every existing project
   * has, on first open after the upgrade, for no gain. That is tens of minutes
   * of keyword-only search for anyone who upgrades.
   */
  readonly model: string;
  private extractor: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;
  private lastLoadError: string | undefined;

  constructor(
    model = DEFAULT_EMBEDDING_MODEL,
    private readonly dtype = DEFAULT_EMBEDDING_DTYPE,
    /**
     * Execution provider, from `xtctx calibrate`; see `device.ts`.
     *
     * Undefined means pass nothing, which is what this did before calibration
     * existed and measured identical to `cpu` on all three operating systems.
     * It is NOT a chain: a device is named here only after being timed against
     * the CPU on this machine, because the one configuration where a GPU is
     * catastrophic is also the one where it does not fail.
     */
    device?: string,
    /**
     * @internal For tests. Replaces the dynamic import of the real pipeline,
     * so a test can observe which device a load was asked for without
     * downloading and running a 130MB model. Which device the model actually
     * loads on is exactly what went untested while calibration never applied.
     */
    private readonly loadPipeline?: PipelineFactory,
  ) {
    this.model = model;
    this.deviceName = device;
  }

  private deviceName: string | undefined;

  get device(): string | undefined {
    return this.deviceName;
  }

  /**
   * Hold the model load until the device is known.
   *
   * Calibration takes about a minute and the model loads lazily, but "lazily"
   * is not "late enough". An earlier version let calibration retarget the
   * provider only if nothing had started loading yet — and the server's own
   * warm scan always started loading first (every scan ends by calling
   * `warm()`), so the retarget was refused on every run. The verdict never
   * applied to the session that paid for it, while the comments and the README
   * said it did.
   *
   * Deferral cannot lose that race. Whoever asks for the model first — the warm
   * scan, a hybrid search's `warm()`, an explicit vector search — gets a load
   * that waits for the device, then loads once, on the right one. Hybrid search
   * is unaffected in practice: it answers from keyword while `isReady()` is
   * false, which it already did while a model downloads. Only an explicit
   * `vector` request waits, and only on the first run on a machine.
   *
   * A device that resolves to undefined, or a rejected promise, leaves the
   * device as it was: a failed calibration is not a reason to stop using the
   * one that has always worked.
   */
  deferDeviceUntil(device: Promise<string | undefined>): void {
    let abandon: () => void = () => {};
    const abandoned = new Promise<undefined>((resolve) => {
      abandon = () => resolve(undefined);
    });
    this.abandonDeferral = abandon;
    // Rejections handled here rather than at the load, which may never happen:
    // a process that exits before embedding anything would otherwise report a
    // failed calibration as an unhandled rejection.
    this.devicePending = Promise.race([device.catch(() => undefined), abandoned]);
  }

  private devicePending: Promise<string | undefined> | null = null;

  /**
   * Stop waiting for calibration and load on the device already configured.
   *
   * Called by anything that needs a vector NOW. The deferral exists so the
   * background warm-up loads the model on the measured device, and nobody is
   * waiting on that. An explicit `vector` search is different: an agent is
   * holding a tool call open, calibration takes about a minute on a fresh
   * machine, and many MCP hosts give up on a call at sixty seconds. Measured on
   * a GitHub ubuntu runner, the first vector search did exactly that — "did not
   * answer within 60s" — because it was waiting for a measurement it did not
   * need. A caller that is waiting wins; the verdict is still written and
   * applies from the next session.
   */
  private abandonDeferral: (() => void) | null = null;

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    // Someone needs vectors now; see `abandonDeferral`. A no-op once the
    // device is known, which is every call after the first load.
    this.abandonDeferral?.();
    const extractor = await this.getExtractor();
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
      const batch = texts.slice(start, start + MAX_BATCH_SIZE);
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      vectors.push(...splitBatchOutput(output, batch.length));
    }
    return vectors;
  }

  isReady(): boolean {
    return this.extractor !== null;
  }

  loadError(): string | undefined {
    return this.lastLoadError;
  }

  warm(): void {
    void this.getExtractor().catch(() => {
      // Still best-effort — nothing is thrown at the caller — but the reason
      // is kept now. Swallowing it entirely made a permanent load failure
      // indistinguishable from a slow first download, forever.
    });
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) {
      return this.extractor;
    }
    // Concurrent callers must not each start their own model load.
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.loadExtractor()
      .then((extractor) => {
        this.lastLoadError = undefined;
        return extractor;
      })
      .catch((error: unknown) => {
        this.lastLoadError = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => {
        // Cleared so the next call retries. A cold cache behind a flaky
        // network fails once and succeeds next time, and refusing to try
        // again would turn a transient fault into a permanent one.
        this.loading = null;
      });
    return this.loading;
  }

  private async loadExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.devicePending) {
      const pending = this.devicePending;
      this.devicePending = null;
      const device = await pending.catch(() => undefined);
      if (device !== undefined) {
        this.deviceName = device;
      }
    }

    process.stderr.write(`xtctx: Initializing local embedding provider (${this.model})...\n`);

    // From the per-user runtime directory, not from this package: the
    // library is an add-on installed by `xtctx embeddings enable`.
    const pipeline =
      this.loadPipeline ??
      ((await importTransformers()) as { pipeline: PipelineFactory }).pipeline;
    const extractor = await pipeline("feature-extraction", this.model, {
      dtype: this.dtype,
      ...(this.deviceName === undefined ? {} : { device: this.deviceName }),
    });

    // `model_max_length` is a getter with no setter in @huggingface/transformers,
    // so assigning it threw a TypeError on every embed call under ESM's strict
    // mode — semantic search failed for every user while hybrid mode silently
    // degraded to keyword-only. Callers segment input to MAX_SEQ_TOKENS via
    // splitTextForEmbedding before it reaches the model, and the model's own
    // 512-token limit is the backstop, so nothing needs to be set here.
    this.extractor = extractor;
    return extractor;
  }
}

function splitBatchOutput(
  output: FeatureExtractionOutput,
  batchSize: number,
): Float32Array[] {
  const flat = toFloat32Array(output.data);
  const dimension = flat.length / batchSize;
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("Embedding model returned an unexpected output shape");
  }

  const vectors: Float32Array[] = [];
  for (let index = 0; index < batchSize; index += 1) {
    vectors.push(flat.slice(index * dimension, (index + 1) * dimension));
  }
  return vectors;
}

function toFloat32Array(data: Float32Array | Float64Array | number[]): Float32Array {
  if (data instanceof Float32Array) {
    return data;
  }
  return Float32Array.from(data);
}

/**
 * Most segments any one window contributes to its vector.
 *
 * Windows are mean-pooled, so a window split into four hundred segments costs
 * four hundred embeddings to produce one averaged vector that represents
 * nothing in particular. Measured over this project's 1,770 windows: the
 * median is 4 segments and the 95th percentile 17, but the largest is 392 —
 * a single 400,899-character window.
 *
 * Sixteen keeps the whole distribution below the 95th percentile intact and
 * touches 5.9% of windows, removing about a fifth of the embedding work. It
 * is a cap on cost, not the main lever: segment *count* was never the
 * dominant term, segment *cost* is (~360ms each on mpnet against ~116ms on
 * MiniLM), so this trims the tail rather than solving the total.
 * @internal Exported for tests only.
 */
export const MAX_SEGMENTS_PER_UNIT = 16;

/**
 * Reduce a window's segments to at most `limit`, spread across its span.
 *
 * Evenly sampled rather than truncated: the opening 16KB of a 400KB window is
 * an arbitrary slice of it, while a spread still reflects how the window
 * begins, develops and ends — which is what a pooled vector is meant to
 * summarise. Order is preserved so pooling stays deterministic.
 */
export function capSegments(segments: string[], limit = MAX_SEGMENTS_PER_UNIT): string[] {
  if (segments.length <= limit) {
    return segments;
  }
  const step = segments.length / limit;
  const sampled: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(segments[Math.min(segments.length - 1, Math.floor(index * step))]);
  }
  return sampled;
}

/**
 * Split text into segments that fit the embedding model's sequence window
 * (~4 chars per token; the default 1000 chars stays under 256 tokens).
 * Splits on line boundaries; a single oversized line is hard-sliced.
 */
export function splitTextForEmbedding(text: string, maxChars = MAX_SEQ_CHARS): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const segments: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > maxChars) {
      if (current) {
        segments.push(current);
        current = "";
      }
      for (let start = 0; start < line.length; start += maxChars) {
        segments.push(line.slice(start, start + maxChars));
      }
      continue;
    }

    if (!current) {
      current = line;
    } else if (current.length + 1 + line.length <= maxChars) {
      current = `${current}\n${line}`;
    } else {
      segments.push(current);
      current = line;
    }
  }
  if (current) {
    segments.push(current);
  }
  return segments;
}

/**
 * Mean-pool segment vectors into one unit vector, re-normalized to unit
 * length so cosine scores stay comparable with single-segment vectors.
 */
export function poolVectors(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 1) {
    return vectors[0];
  }

  const dimensions = vectors[0]?.length ?? 0;
  const pooled = new Float32Array(dimensions);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      pooled[index] += vector[index];
    }
  }

  let norm = 0;
  for (let index = 0; index < dimensions; index += 1) {
    pooled[index] /= vectors.length;
    norm += pooled[index] * pooled[index];
  }
  if (norm > 0) {
    const scale = 1 / Math.sqrt(norm);
    for (let index = 0; index < dimensions; index += 1) {
      pooled[index] *= scale;
    }
  }
  return pooled;
}
