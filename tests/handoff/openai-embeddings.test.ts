import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAiEmbeddingProvider,
  openAiEmbeddingIdentity,
  retryDelayMs,
} from "@xtctx/handoff/openai-embeddings";
import { DEFAULT_EMBEDDING_MODEL, TransformersEmbeddingProvider } from "@xtctx/handoff/embeddings";
import { parseEmbeddingConfig } from "@xtctx/handoff/embedding-config";

describe("OpenAiEmbeddingProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses the composite vector identity string", () => {
    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "https://api.openai.com/v1/",
      model: "text-embedding-3-small",
    });

    expect(provider.model).toBe("openai:https://api.openai.com/v1:text-embedding-3-small");
    expect(openAiEmbeddingIdentity("https://api.openai.com/v1", "text-embedding-3-small")).toBe(
      provider.model,
    );
  });

  it("leaves the local identity as the bare HuggingFace id", () => {
    // Deliberately NOT `local:Xenova/…`, which the design doc suggests. Every
    // remote identity is `openai:…`-prefixed and cannot collide with a
    // HuggingFace id, so prefixing the local one buys nothing — while renaming
    // it makes dropVectorsFromOtherModels discard every vector in every
    // existing project on the first open after upgrading.
    expect(new TransformersEmbeddingProvider().model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(new TransformersEmbeddingProvider().model.startsWith("local:")).toBe(false);
  });

  it("places each vector by the index the response declares, not its position", async () => {
    // A batch endpoint is not required to answer in request order, which is
    // why the OpenAI shape carries `index` at all. Reading positionally pairs
    // every window with another window's vector: search keeps working and
    // keeps ranking against the wrong text, and nothing fails.
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        data: [
          { index: 2, embedding: [0, 0, 1] },
          { index: 0, embedding: [1, 0, 0] },
          { index: 1, embedding: [0, 1, 0] },
        ],
      }),
    ) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    const vectors = await provider.embedBatch(["first", "second", "third"]);

    expect([...vectors[0]]).toEqual([1, 0, 0]);
    expect([...vectors[1]]).toEqual([0, 1, 0]);
    expect([...vectors[2]]).toEqual([0, 0, 1]);
  });

  it("rejects a response that indexes the same slot twice", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 0, embedding: [0, 1] },
        ],
      }),
    ) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    await expect(provider.embedBatch(["a", "b"])).rejects.toThrow(/out-of-range index/);
  });

  it("scales returned vectors to unit length", async () => {
    // The local pipeline passes `normalize: true`. An endpoint that does not
    // would leave poolVectors mean-pooling vectors of different magnitudes,
    // which weights a window's segments by length instead of equally.
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ data: [{ index: 0, embedding: [3, 4] }] }),
    ) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    const [vector] = await provider.embedBatch(["a"]);

    expect(vector[0]).toBeCloseTo(0.6, 6);
    expect(vector[1]).toBeCloseTo(0.8, 6);
  });

  it("batches requests to batchSize and reads data[].embedding", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const input = (bodies.at(-1) as { input: string[] }).input;
      return jsonResponse({
        data: input.map((_, index) => ({ embedding: [index + 1, 0] })),
      });
    }) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
      batchSize: 2,
    });

    const vectors = await provider.embedBatch(["a", "b", "c"]);

    expect(bodies).toEqual([
      { model: "nomic-embed-text", input: ["a", "b"] },
      { model: "nomic-embed-text", input: ["c"] },
    ]);
    expect(vectors).toHaveLength(3);
    expect([...vectors[0]]).toEqual([1, 0]);
    expect([...vectors[2]]).toEqual([1, 0]);
    expect(provider.isReady()).toBe(true);
    provider.warm();
  });

  it("retries once on 429 then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      }
      return jsonResponse({ data: [{ embedding: [1, 1] }] });
    }) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    const [vector] = await provider.embedBatch(["once"]);
    expect(calls).toBe(2);
    // Normalized on receipt; see `normalized` in the provider.
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("retries once on 5xx then gives up", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    await expect(provider.embedBatch(["x"])).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(2);
  });

  it("honours timeoutMs via AbortSignal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    globalThis.fetch = vi.fn(async (_url, init) => {
      expect(init?.signal).toBeDefined();
      return jsonResponse({ data: [{ embedding: [1] }] });
    }) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
      timeoutMs: 12_345,
    });

    await provider.embedBatch(["ok"]);
    expect(timeoutSpy).toHaveBeenCalledWith(12_345);
  });

  it("rejects a malformed body", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ data: "nope" })) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    await expect(provider.embedBatch(["x"])).rejects.toThrow(/malformed body/);
  });

  it("rejects 401 without leaking the API key in the error", async () => {
    const secret = "sk-secret-test-key-do-not-leak";
    process.env.XTCTX_TEST_EMBED_KEY = secret;
    try {
      globalThis.fetch = vi.fn(async () => {
        return new Response(`unauthorized for ${secret}`, { status: 401 });
      }) as typeof fetch;

      const provider = new OpenAiEmbeddingProvider({
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKeyEnv: "XTCTX_TEST_EMBED_KEY",
      });

      let message = "";
      try {
        await provider.embedBatch(["x"]);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/HTTP 401/);
      expect(message).not.toContain(secret);
    } finally {
      delete process.env.XTCTX_TEST_EMBED_KEY;
    }
  });
});

describe("retrying a rate limit", () => {
  it("waits for what Retry-After asks, in seconds or as a date", () => {
    expect(retryDelayMs("2")).toBe(2_000);
    const now = Date.parse("2026-09-23T10:00:00.000Z");
    expect(retryDelayMs("Wed, 23 Sep 2026 10:00:03 GMT", now)).toBe(3_000);
  });

  it("never waits longer than the cap, however long it is asked to", () => {
    // One stalled call must not stall a whole vectorizing pass.
    expect(retryDelayMs("3600")).toBe(5_000);
  });

  it("waits a default second when the header is absent or unreadable", () => {
    expect(retryDelayMs(null)).toBe(1_000);
    expect(retryDelayMs("soon")).toBe(1_000);
    expect(retryDelayMs("-5")).toBe(1_000);
  });
});

describe("error responses", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("releases the body of a response it gives up on", async () => {
    // A misconfigured endpoint answers every chunk with an error, and each
    // unread body held its connection until garbage collection.
    let cancelled = false;
    globalThis.fetch = vi.fn(async () => {
      const body = new ReadableStream({
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 404 });
    }) as typeof fetch;

    const provider = new OpenAiEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });

    await expect(provider.embedBatch(["x"])).rejects.toThrow(/HTTP 404/);
    expect(cancelled).toBe(true);
  });
});

describe("parseEmbeddingConfig", () => {
  it("rejects a literal apiKey because the config file is committable", () => {
    expect(() =>
      parseEmbeddingConfig({
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "nomic-embed-text",
        apiKey: "sk-in-the-file",
      }),
    ).toThrow(/committable/);
  });

  it("rejects an unknown provider instead of falling back to local", () => {
    expect(() => parseEmbeddingConfig({ provider: "azure" })).toThrow(/openai-compatible/);
  });

  it("defaults to local when the block is absent", () => {
    expect(parseEmbeddingConfig(undefined).provider).toBe("local");
  });

  // `.xtctx/config.yaml` is committed, so a cloned repository chooses these
  // values. Honoured as written, it could send transcript text to any host
  // with any environment variable's value as the key.
  describe("endpoint trust", () => {
    const block = (baseUrl: string) => ({ provider: "openai-compatible", baseUrl, model: "m" });
    const trust = (list: string) => ({ XTCTX_TRUSTED_EMBEDDING_ENDPOINTS: list });

    it("refuses a remote endpoint the user has not trusted", () => {
      expect(() => parseEmbeddingConfig(block("https://collector.example/v1"), {})).toThrow(
        /https:\/\/collector\.example\/v1 is not trusted.*XTCTX_TRUSTED_EMBEDDING_ENDPOINTS/,
      );
    });

    it("never lets the project name the key variable", () => {
      expect(() =>
        parseEmbeddingConfig({ ...block("https://api.openai.com/v1"), apiKeyEnv: "GITHUB_TOKEN" }, trust("https://api.openai.com")),
      ).toThrow(/apiKeyEnv is not read from .xtctx\/config.yaml.*XTCTX_EMBEDDING_API_KEY/);
    });

    it("allows a loopback endpoint without being listed, but sends it no key", () => {
      for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:9000/v1"]) {
        const config = parseEmbeddingConfig(block(url), {});
        expect(config.baseUrl).toBe(url);
        expect(config.apiKeyEnv).toBeUndefined();
      }
    });

    it("sends the user's own key variable only to a listed endpoint", () => {
      const config = parseEmbeddingConfig(
        block("https://api.openai.com/v1"),
        trust("http://localhost:1, https://api.openai.com/v1"),
      );
      expect(config.baseUrl).toBe("https://api.openai.com/v1");
      expect(config.apiKeyEnv).toBe("XTCTX_EMBEDDING_API_KEY");
    });

    it("matches whole path segments under the listed base, not the origin", () => {
      // On a shared gateway the account is in the path.
      const env = trust("https://gateway.example/v1/mine");
      expect(parseEmbeddingConfig(block("https://gateway.example/v1/mine/openai"), env).apiKeyEnv).toBe(
        "XTCTX_EMBEDDING_API_KEY",
      );
      for (const url of [
        "https://gateway.example/v1/theirs/openai",
        "https://gateway.example/v1/mine-too",
        "https://gateway.example/v1/mine/../theirs",
        "https://gateway.example.collector.example/v1/mine",
        "http://gateway.example/v1/mine",
      ]) {
        expect(() => parseEmbeddingConfig(block(url), env), url).toThrow(/not trusted/);
      }
    });

    it("refuses credentials, a query or a fragment, which can smuggle a different path", () => {
      for (const url of [
        "http://127.0.0.1:9200/transcripts/_doc?x=",
        "http://localhost:1/v1#",
        "https://user:pass@api.openai.com/v1",
      ]) {
        expect(() => parseEmbeddingConfig(block(url), {}), url).toThrow(/credentials, a query or a fragment/);
      }
    });

    it("rejects a non-http scheme", () => {
      expect(() => parseEmbeddingConfig(block("file:///etc/passwd"), {})).toThrow(/http or https/);
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
