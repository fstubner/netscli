/**
 * Semantic search is off until `xtctx embeddings enable`, and off must be a
 * state that works, not a failure that is merely survived.
 *
 * Before the model became an add-on, "no embeddings" was only ever a test
 * configuration (`XTCTX_DISABLE_EMBEDDINGS=1`), and it was handled by letting
 * every embed call throw and catching it: an error on stderr and an
 * `embedding_error` in status for each search, "N windows not yet vectorized"
 * on every answer, and — the one that mattered once real indexes met it — a
 * placeholder model identity that `dropVectorsFromOtherModels` read as "another
 * model" and used to delete every vector the index had.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderStatusBlock } from "@xtctx/cli/status";
import { setupProject } from "@xtctx/config/setup";
import { createEmbeddingProvider, defaultEmbeddingConfig } from "@xtctx/handoff/embedding-config";
import { RUNTIME_DIR_ENV } from "@xtctx/handoff/embedding-runtime";
import { TransformersEmbeddingProvider, type EmbeddingProvider } from "@xtctx/handoff/embeddings";
import { NullEmbeddingProvider } from "@xtctx/handoff/null-embeddings";
import { OpenAiEmbeddingProvider } from "@xtctx/handoff/openai-embeddings";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { createContinuityStatusHandler } from "@xtctx/mcp/tools/continuity";
import { createSearchSessionsHandler } from "@xtctx/mcp/tools/sessions";
import { createProjectServices } from "@xtctx/runtime/services";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly model = "fixture-embedding";
  async embed(text: string): Promise<Float32Array> {
    return (await this.embedBatch([text]))[0];
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vector = new Float32Array(8);
      for (let i = 0; i < text.length; i += 1) vector[i % 8] += text.charCodeAt(i) / 1000;
      return vector;
    });
  }
}

class FixtureScraper implements ConversationScraper {
  readonly tool = "codex";
  async detect(): Promise<boolean> {
    return true;
  }
  getStorePaths(): string[] {
    return ["fixture://codex"];
  }
  async *scrape(): AsyncIterable<ConversationChunk> {
    yield* this.fullSync();
  }
  async *fullSync(): AsyncIterable<ConversationChunk> {
    for (let index = 0; index < 12; index += 1) {
      yield {
        tool: "codex",
        sessionId: "off-session",
        timestamp: new Date(Date.parse("2026-05-10T10:00:00.000Z") + index * 1000),
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index} about the token refresh regression`,
        metadata: { messageIndex: index, tokenEstimate: 1, layer: 0 },
      };
    }
  }
  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }
  async saveScrapedPosition(): Promise<void> {}
}

describe("search with semantic search off", () => {
  let dir = "";
  let open: SqliteHandoffIndex[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-semantic-off-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const index of open) await index.close().catch(() => {});
    open = [];
    await rm(dir, { recursive: true, force: true });
  });

  function build(provider: EmbeddingProvider): SqliteHandoffIndex {
    const index = new SqliteHandoffIndex(
      join(dir, "xtctx.db"),
      dir,
      [{ tool: "codex", scraper: new FixtureScraper() }],
      { refreshBudgetMs: 30_000, embeddingProvider: provider },
    );
    open.push(index);
    return index;
  }

  it("finds things by keyword straight away, in every mode but vector", async () => {
    const index = build(new NullEmbeddingProvider("not_enabled"));
    const stderr = vi.spyOn(process.stderr, "write");

    for (const mode of ["hybrid", "keyword"] as const) {
      const results = await index.searchSessions("token refresh", 5, undefined, mode);
      expect(results.length, mode).toBeGreaterThan(0);
    }

    // Not reported as a fault: this is the default state, not a failure that was
    // survived. Each used to put a line on stderr and an error in status.
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).not.toContain("semantic search unavailable");
    const status = await index.getStatus();
    expect(status.embedding_error).toBeNull();
    expect(status.semantic_search).toBe("off");
    expect(status.semantic_off_reason).toBe("not_enabled");
    expect(status.vector_segment_backlog).toBe(0);
  });

  it("says how to turn it on when vector search is asked for by name", async () => {
    const index = build(new NullEmbeddingProvider("not_enabled"));
    await expect(index.searchSessions("token refresh", 5, undefined, "vector")).rejects.toThrow(
      "xtctx embeddings enable",
    );
  });

  it("does not put 'Indexing in progress' on the answer", async () => {
    const index = build(new NullEmbeddingProvider("not_enabled"));
    const answer = await createSearchSessionsHandler(index)({ query: "token refresh" });

    expect(String(answer)).toContain("token refresh");
    expect(String(answer)).not.toContain("not yet vectorized");
    expect(String(answer)).not.toContain("embedding model still loading");
  });

  it("keeps vectors an earlier install built, and uses them again when it is back on", async () => {
    const first = build(new FixtureEmbeddingProvider());
    await first.searchSessions("token refresh", 5, undefined, "hybrid");
    await first.whenScanSettled();
    const embedded = (await first.getStatus()).vectorized_units;
    expect(embedded).toBeGreaterThan(0);
    await first.close();

    // Reopened with the add-on gone. The placeholder model identity must not
    // read as "another model" and wipe what the index has.
    const off = build(new NullEmbeddingProvider("not_enabled"));
    await off.searchSessions("token refresh", 5, undefined, "hybrid");
    const status = await off.getStatus();
    expect(status.vectorized_units).toBe(embedded);
    expect(status.semantic_search).toBe("off");
    await off.close();

    const back = build(new FixtureEmbeddingProvider());
    expect((await back.getStatus()).vectorized_units).toBe(embedded);
  });
});

describe("which provider a project gets", () => {
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "xtctx-provider-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("XTCTX_DISABLE_EMBEDDINGS", "0");
    vi.stubEnv(RUNTIME_DIR_ENV, "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it("is off by default, because the local model is not installed", () => {
    const provider = createEmbeddingProvider(defaultEmbeddingConfig());
    expect(provider).toBeInstanceOf(NullEmbeddingProvider);
    expect(provider.semanticOff).toBe("not_enabled");
  });

  it("is the switch-off from the environment when that is set, whatever is installed", () => {
    vi.stubEnv("XTCTX_DISABLE_EMBEDDINGS", "1");
    expect(createEmbeddingProvider(defaultEmbeddingConfig()).semanticOff).toBe("disabled_by_env");
  });

  it("is the local model once the add-on is there", async () => {
    const runtime = await mkdtemp(join(tmpdir(), "xtctx-provider-runtime-"));
    try {
      const manifest = join(runtime, "node_modules", "@huggingface", "transformers");
      await mkdir(manifest, { recursive: true });
      await writeFile(join(manifest, "package.json"), "{}", "utf-8");
      vi.stubEnv(RUNTIME_DIR_ENV, runtime);

      const provider = createEmbeddingProvider(defaultEmbeddingConfig());
      expect(provider).toBeInstanceOf(TransformersEmbeddingProvider);
      expect(provider.semanticOff).toBeUndefined();
    } finally {
      await rm(runtime, { recursive: true, force: true });
    }
  });

  it("leaves a remote endpoint alone: it needs no local runtime", () => {
    const provider = createEmbeddingProvider({
      ...defaultEmbeddingConfig(),
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    });
    expect(provider).toBeInstanceOf(OpenAiEmbeddingProvider);
    expect(provider.semanticOff).toBeUndefined();
  });
});

describe("what status says about semantic search", () => {
  let projectRoot = "";
  let homeDir = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "xtctx-semantic-status-"));
    homeDir = await mkdtemp(join(tmpdir(), "xtctx-semantic-status-home-"));
    await setupProject({ projectPath: projectRoot, homeDir, yes: true });
    // Nothing for the scrapers to read: this is about the words, not the data.
    await writeFile(
      join(projectRoot, ".xtctx", "config.yaml"),
      [
        "tools:",
        ...["claude-code", "cursor", "codex", "copilot", "antigravity", "opencode", "copilot-cli"].flatMap(
          (tool) => [`  ${tool}:`, "    enabled: false"],
        ),
        "",
      ].join("\n"),
      "utf-8",
    );
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("USERPROFILE", homeDir);
    vi.stubEnv("XTCTX_DISABLE_EMBEDDINGS", "0");
    vi.stubEnv(RUNTIME_DIR_ENV, "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("names the mode and the command to change it, in xtctx status and in the MCP tool", async () => {
    const services = await createProjectServices(projectRoot);
    try {
      const block = await renderStatusBlock(services, { homeDir });
      expect(block).toMatch(/Search\s+keyword only\. Semantic search is optional: run `xtctx embeddings enable`/);
      // No fake progress for work that is not going to happen.
      expect(block).not.toContain("vectorized");
      expect(block).not.toContain("outstanding");

      const markdown = String(await createContinuityStatusHandler(services.sessions)({}));
      expect(markdown).toContain("Semantic search: off, answering from keyword only");
      expect(markdown).toContain("xtctx embeddings enable");
      expect(markdown).not.toContain("Vector model");

      const json = (await createContinuityStatusHandler(services.sessions)({ format: "json" })) as {
        semantic_search: string;
        semantic_off_reason: string;
      };
      expect(json).toMatchObject({ semantic_search: "off", semantic_off_reason: "not_enabled" });
    } finally {
      await services.sessions.close();
    }
  });

  it("says so when the environment switch is what turned it off", async () => {
    vi.stubEnv("XTCTX_DISABLE_EMBEDDINGS", "1");
    const services = await createProjectServices(projectRoot);
    try {
      const block = await renderStatusBlock(services, { homeDir });
      expect(block).toMatch(/Search\s+keyword only \(XTCTX_DISABLE_EMBEDDINGS=1 is set\)/);
    } finally {
      await services.sessions.close();
    }
  });

  it("reports vectors an earlier install built as kept, not as an error", async () => {
    const services = await createProjectServices(projectRoot);
    try {
      const real = await services.sessions.getStatus();
      services.sessions.getStatus = async () => ({ ...real, retrieval_units: 40, vectorized_units: 31 });
      const block = await renderStatusBlock(services, { homeDir });
      expect(block).toContain("31 windows already have vectors; they are kept");
      expect(block).not.toContain("UNREADABLE");
      expect(block).not.toContain("unavailable");
    } finally {
      await services.sessions.close();
    }
  });
});
