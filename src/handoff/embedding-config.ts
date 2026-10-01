import {
  DEFAULT_EMBEDDING_MODEL,
  TransformersEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.js";
import { OpenAiEmbeddingProvider } from "./openai-embeddings.js";
import { isRuntimeInstalled } from "./embedding-runtime.js";
import { NullEmbeddingProvider } from "./null-embeddings.js";
import { MIN_CONFIDENT_COSINE, MIN_SEMANTIC_COSINE } from "./ranking.js";
import type { EmbeddingConfig } from "../types/config.js";

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Where the user, not the project, says which embedding endpoints xtctx may
 * send transcript text to: a comma-separated list of origins.
 */
export const TRUSTED_ENDPOINTS_ENV = "XTCTX_TRUSTED_EMBEDDING_ENDPOINTS";

/** The one variable a remote embedding key is read from, and only for a trusted endpoint. */
export const EMBEDDING_KEY_ENV = "XTCTX_EMBEDDING_API_KEY";

export function defaultEmbeddingConfig(): EmbeddingConfig {
  return {
    provider: "local",
    batchSize: DEFAULT_BATCH_SIZE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    minSemanticCosine: MIN_SEMANTIC_COSINE,
    minConfidentCosine: MIN_CONFIDENT_COSINE,
  };
}

/**
 * Parse the optional `embedding:` block from `.xtctx/config.yaml`.
 *
 * Throws on a literal `apiKey` or an `apiKeyEnv` (the file is committable),
 * an unknown provider, an incomplete openai-compatible block, or an endpoint
 * the user has not trusted (see endpointTrust). Missing block → local
 * defaults; never inferred from environment alone.
 */
export function parseEmbeddingConfig(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingConfig {
  if (input === undefined || input === null) {
    return defaultEmbeddingConfig();
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("embedding: expected a mapping");
  }

  const raw = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, "apiKey")) {
    // `.xtctx/config.yaml` is committed with the project. A key written into
    // it would publish the credential to everyone who clones the repository.
    throw new Error(
      "embedding.apiKey is not allowed: .xtctx/config.yaml is committable — " +
        "set embedding.apiKeyEnv to the name of an environment variable instead",
    );
  }

  const defaults = defaultEmbeddingConfig();
  const providerRaw = raw.provider === undefined ? "local" : raw.provider;
  if (providerRaw !== "local" && providerRaw !== "openai-compatible") {
    throw new Error(
      `embedding.provider must be "local" or "openai-compatible", got ${JSON.stringify(providerRaw)}`,
    );
  }

  const config: EmbeddingConfig = {
    provider: providerRaw,
    batchSize: readPositiveInt(raw.batchSize, defaults.batchSize, "embedding.batchSize"),
    timeoutMs: readPositiveInt(raw.timeoutMs, defaults.timeoutMs, "embedding.timeoutMs"),
    minSemanticCosine: readFiniteNumber(
      raw.minSemanticCosine,
      defaults.minSemanticCosine,
      "embedding.minSemanticCosine",
    ),
    minConfidentCosine: readFiniteNumber(
      raw.minConfidentCosine,
      defaults.minConfidentCosine,
      "embedding.minConfidentCosine",
    ),
  };

  if (Object.prototype.hasOwnProperty.call(raw, "apiKeyEnv")) {
    // The file is committed, so the repository would choose which of the
    // user's environment variables to send, and a GitHub or cloud token is
    // as easy to name as an embedding key. The key comes from the user's own
    // environment instead, under a name a repository cannot pick.
    throw new Error(
      "embedding.apiKeyEnv is not read from .xtctx/config.yaml: a repository could name any " +
        `environment variable. Put the key in ${EMBEDDING_KEY_ENV} in your own environment instead`,
    );
  }

  if (providerRaw === "openai-compatible") {
    if (typeof raw.baseUrl !== "string" || raw.baseUrl.trim().length === 0) {
      throw new Error('embedding.baseUrl is required when provider is "openai-compatible"');
    }
    if (typeof raw.model !== "string" || raw.model.trim().length === 0) {
      throw new Error('embedding.model is required when provider is "openai-compatible"');
    }
    config.baseUrl = raw.baseUrl.trim().replace(/\/+$/, "");
    config.model = raw.model.trim();
    if (endpointTrust(config.baseUrl, env) === "trusted") {
      // Sent only to an endpoint the user listed. A loopback endpoint that is
      // allowed without being listed gets no key at all.
      config.apiKeyEnv = EMBEDDING_KEY_ENV;
    }
  }

  return config;
}

/**
 * Whether the user, outside the repository, has allowed this endpoint.
 *
 * `.xtctx/config.yaml` is committed with the project, so whoever wrote the
 * repository chose `baseUrl`. Honoured as written, a cloned repo could send
 * the user's transcript text to any host as soon as an agent searched in it;
 * the plugin makes xtctx live in every repository, so no setup step stands in
 * between.
 *
 * A loopback endpoint is allowed without being listed, but gets no key: a
 * local model server is the case the feature was written for. Anything else
 * must fall under a base URL listed in XTCTX_TRUSTED_EMBEDDING_ENDPOINTS,
 * matched by whole path segments rather than by origin, because on a shared
 * gateway the account is in the path: trusting
 * `https://gateway.example/v1/mine` must not also trust
 * `https://gateway.example/v1/theirs`.
 */
function endpointTrust(baseUrl: string, env: NodeJS.ProcessEnv): "trusted" | "loopback" {
  const url = parseEndpoint(baseUrl, "embedding.baseUrl");
  const trusted = (env[TRUSTED_ENDPOINTS_ENV] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        return [parseEndpoint(entry, TRUSTED_ENDPOINTS_ENV)];
      } catch {
        return [];
      }
    });
  if (trusted.some((prefix) => underBase(url, prefix))) {
    return "trusted";
  }
  if (isLoopback(url.hostname)) {
    return "loopback";
  }
  throw new Error(
    `embedding endpoint ${url.href.replace(/\/$/, "")} is not trusted: this project's config asks ` +
      "xtctx to send transcript text there. If you set this up, add it to " +
      `${TRUSTED_ENDPOINTS_ENV} in the environment your agents start from; a repository cannot ` +
      "set that for you.",
  );
}

/** An http(s) base URL with no credentials, query or fragment to smuggle a path through. */
function parseEndpoint(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must be http or https, got ${url.protocol}`);
  }
  // Checked on the raw string too: an empty `?` or `#` parses to nothing but
  // still cuts off the `/embeddings` appended to it.
  if (url.username || url.password || /[?#]/.test(value)) {
    throw new Error(`${label} must not carry credentials, a query or a fragment: ${JSON.stringify(value)}`);
  }
  return url;
}

function underBase(url: URL, base: URL): boolean {
  if (url.origin !== base.origin) {
    return false;
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  const path = url.pathname.replace(/\/+$/, "");
  return path === basePath || path.startsWith(`${basePath}/`);
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function createEmbeddingProvider(
  config: EmbeddingConfig,
  /** Calibrated execution provider, if this machine has been calibrated. */
  device?: string,
): EmbeddingProvider {
  if (process.env.XTCTX_DISABLE_EMBEDDINGS === "1") {
    return new NullEmbeddingProvider("disabled_by_env");
  }
  if (config.provider === "openai-compatible") {
    if (!config.baseUrl || !config.model) {
      // parseEmbeddingConfig already requires these; defend the type.
      throw new Error("openai-compatible embedding config is missing baseUrl or model");
    }
    return new OpenAiEmbeddingProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyEnv: config.apiKeyEnv,
      batchSize: config.batchSize,
      timeoutMs: config.timeoutMs,
    });
  }
  // The remote path above needs no local runtime and is unaffected. The local
  // one is an add-on, and without it there is no model to load: semantic
  // search is off, which `xtctx status` says along with how to turn it on.
  if (!isRuntimeInstalled()) {
    return new NullEmbeddingProvider("not_enabled");
  }
  return new TransformersEmbeddingProvider(DEFAULT_EMBEDDING_MODEL, undefined, device);
}

/**
 * Whether this project will embed with the local model: configured for it, not
 * switched off, and the add-on is installed.
 *
 * What gates work that only the local model needs, such as measuring devices.
 */
export function localEmbeddingsActive(
  config: EmbeddingConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return config.provider === "local" && env.XTCTX_DISABLE_EMBEDDINGS !== "1" && isRuntimeInstalled({ env });
}

function readPositiveInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.floor(value);
}

function readFiniteNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}
