import type { EmbeddingProvider } from "./embeddings.js";

export interface OpenAiEmbeddingProviderOptions {
  baseUrl: string;
  /** Remote model name sent in the request body — not the composite identity. */
  model: string;
  /** Name of the env var that holds the key; the key itself is never stored. */
  apiKeyEnv?: string;
  batchSize?: number;
  timeoutMs?: number;
}

/**
 * Vector identity for an OpenAI-compatible endpoint.
 *
 * Two services can both advertise `text-embedding-3-small` while producing
 * vectors in different spaces. Keying stored vectors on the bare model name
 * would leave those mixed in `retrieval_unit_vectors`; including the endpoint
 * makes a change of either endpoint or model invalidate the same way a local
 * model change already does.
 */
export function openAiEmbeddingIdentity(baseUrl: string, model: string): string {
  return `openai:${normalizeBaseUrl(baseUrl)}:${model}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Embedding provider that POSTs to an OpenAI-compatible `/embeddings` endpoint.
 *
 * Opt-in only: constructed when a project names one in `.xtctx/config.yaml`.
 * No SDK — one HTTP shape, global `fetch`.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly remoteModel: string;
  private readonly apiKeyEnv: string | undefined;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.remoteModel = options.model;
    this.apiKeyEnv = options.apiKeyEnv;
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 32));
    this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 30_000));
    this.model = openAiEmbeddingIdentity(this.baseUrl, this.remoteModel);
  }

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize);
      vectors.push(...(await this.embedChunk(batch)));
    }
    return vectors;
  }

  isReady(): boolean {
    // No local model to load — the endpoint is ready whenever it answers.
    return true;
  }

  warm(): void {
    // Nothing to preload; removes the warm-budget wait rather than adding a
    // second code path for remote providers.
  }

  private async embedChunk(texts: string[]): Promise<Float32Array[]> {
    let response = await this.postEmbeddings(texts);
    // One retry on transient failures, then give up for this call. Vectorizing
    // is incremental and resumable, so a failed pass costs a pass, not the
    // index — and clever backoff would only hide an endpoint that is down.
    if (response.status === 429 || response.status >= 500) {
      // Discard the first body before asking again. An unread response holds
      // its connection open in undici until it is garbage collected, and a
      // vectorizing pass makes this call hundreds of times.
      await response.body?.cancel().catch(() => {});
      // A 429 is the server asking to be asked later, so the retry waits —
      // for `Retry-After` when it says, bounded so one call cannot stall a
      // pass. Retrying a rate limit instantly almost always earns a second 429.
      // A 5xx retries at once: that one is not a request to slow down.
      if (response.status === 429) {
        await sleep(retryDelayMs(response.headers.get("retry-after")));
      }
      response = await this.postEmbeddings(texts);
    }
    if (!response.ok) {
      // Same reason as above, on the path that gives up: a misconfigured
      // endpoint answers every call with an error, and each unread body held a
      // connection until GC — one per chunk across a whole pass.
      await response.body?.cancel().catch(() => {});
      throw new Error(safeHttpError(response.status));
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("Embedding endpoint returned a non-JSON body");
    }

    return parseEmbeddingResponse(body, texts.length);
  }

  private async postEmbeddings(texts: string[]): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const apiKey = this.readApiKey();
    if (apiKey !== undefined) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.remoteModel, input: texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
      // Not followed: a 307/308 re-sends the body, transcript text and key
      // included, to wherever the endpoint points, which is not the endpoint
      // the user trusted.
      redirect: "error",
    });
  }

  private readApiKey(): string | undefined {
    if (!this.apiKeyEnv) {
      return undefined;
    }
    const value = process.env[this.apiKeyEnv];
    if (value === undefined || value.length === 0) {
      // Name the env var, never a value that might have been set wrong.
      throw new Error(`Embedding API key environment variable ${this.apiKeyEnv} is not set`);
    }
    return value;
  }
}

/** Longest a single 429 retry waits, whatever `Retry-After` asks for. */
const MAX_RETRY_DELAY_MS = 5_000;
/** Wait when a 429 gives no `Retry-After`. */
const DEFAULT_RETRY_DELAY_MS = 1_000;

/** `Retry-After` in seconds or as an HTTP date, clamped; see `embedChunk`. */
export function retryDelayMs(header: string | null, now = Date.now()): number {
  if (header === null) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - now;
  if (!Number.isFinite(delay) || delay < 0) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeHttpError(status: number): string {
  // Status only — response bodies from auth failures often echo the key or
  // request id material that should not land in `embedding_error` / logs.
  return `Embedding endpoint returned HTTP ${status}`;
}

function parseEmbeddingResponse(body: unknown, expectedCount: number): Float32Array[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Embedding endpoint returned a malformed body");
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error("Embedding endpoint returned a malformed body");
  }

  // Placed by the response's own `index`, not by position in `data`.
  //
  // The OpenAI embeddings shape carries `index` on every element precisely
  // because the array order is not promised, and a batch endpoint that answers
  // out of order is free to. Reading positionally would pair each window with
  // another window's vector — search would still return results, ranked by a
  // similarity computed against the wrong text, with nothing failing anywhere.
  // An endpoint that omits `index` falls back to position, which is all there
  // is to go on.
  const vectors = new Array<Float32Array | undefined>(expectedCount);
  data.forEach((item, position) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Embedding endpoint returned a malformed body");
    }
    const declared = (item as { index?: unknown }).index;
    const slot = typeof declared === "number" && Number.isInteger(declared) ? declared : position;
    if (slot < 0 || slot >= expectedCount || vectors[slot] !== undefined) {
      throw new Error(`Embedding endpoint returned an out-of-range index ${slot}`);
    }

    const embedding = (item as { embedding?: unknown }).embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Embedding endpoint returned a malformed embedding at index ${slot}`);
    }
    if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error(`Embedding endpoint returned a malformed embedding at index ${slot}`);
    }
    vectors[slot] = normalized(Float32Array.from(embedding as number[]));
  });

  return vectors as Float32Array[];
}

/**
 * Scale to unit length, matching the local pipeline's `normalize: true`.
 *
 * Not for the cosine — `cosineSimilarity` divides by both norms, so scoring
 * would survive either way. It is for `poolVectors`, which mean-pools a
 * window's segments before storing one vector. Mean-pooling vectors of
 * differing magnitude weights each segment by its length rather than treating
 * them equally, so a window's vector would drift toward whichever segment the
 * endpoint happened to return longest. OpenAI returns unit vectors and this is
 * then a no-op; Ollama and LM Studio do not promise to.
 */
function normalized(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  if (norm === 0) {
    return vector;
  }
  const scale = 1 / Math.sqrt(norm);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] *= scale;
  }
  return vector;
}
