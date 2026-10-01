/**
 * `vectorBacklog` says how many indexed windows still have no vector, which
 * is how an agent learns that semantic recall is partial: it reaches callers
 * as `vector_backlog` in the manifest's JSON and as the "Embedding
 * outstanding: N windows" line in continuity status.
 *
 * Nothing asserted it. Found while splitting the index into modules: making
 * `countUnvectorizedUnits` off by one, or having it answer zero, failed no
 * test in the suite. A backlog that reads zero while thousands of windows are
 * unvectorized is the same failure this project keeps finding elsewhere — a
 * partial answer presented as a complete one, which an agent believes.
 *
 * So this pins the two ends: an index that has never embedded reports its
 * windows outstanding, and one that has embedded them reports none.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import type { EmbeddingProvider } from "@xtctx/handoff/embeddings";
import { NullEmbeddingProvider } from "@xtctx/handoff/null-embeddings";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

/** Deterministic vectors; the values do not matter here, only that they exist. */
class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly model = "fixture-embedding";

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vector = new Float32Array(8);
      for (let i = 0; i < text.length; i += 1) {
        vector[i % vector.length] += text.charCodeAt(i) / 1000;
      }
      return vector;
    });
  }
}

class FixtureScraper implements ConversationScraper {
  readonly tool = "codex";

  constructor(private readonly chunks: ConversationChunk[]) {}

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
    yield* this.chunks;
  }
  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }
  async saveScrapedPosition(): Promise<void> {}
}

/** Enough messages to build more than one window, so a count can be wrong. */
function conversation(): ConversationChunk[] {
  return Array.from({ length: 24 }, (_, index) => ({
    tool: "codex",
    sessionId: "backlog-session",
    timestamp: new Date(Date.parse("2026-05-10T10:00:00.000Z") + index * 1000),
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${index} about the token refresh regression`,
    metadata: { messageIndex: index, tokenEstimate: 1, layer: 0 },
  }));
}

describe("vectorBacklog", () => {
  let dir = "";
  let index: SqliteHandoffIndex | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-backlog-"));
  });

  afterEach(async () => {
    await index?.close().catch(() => {});
    index = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  function build(provider?: EmbeddingProvider, freezeVectors = false): SqliteHandoffIndex {
    return new SqliteHandoffIndex(
      join(dir, "xtctx.db"),
      dir,
      [{ tool: "codex", scraper: new FixtureScraper(conversation()) }],
      {
        refreshBudgetMs: 30_000,
        freezeVectors,
        ...(provider ? { embeddingProvider: provider } : {}),
      },
    );
  }

  it("counts every window an index has not embedded yet", async () => {
    // `listRecentSessions` scans and builds windows; it does not embed. Vectors
    // are frozen so the scan's own warm-up pass leaves them alone, and a real
    // provider is used because with semantic search off there is no backlog
    // (see the next test).
    index = build(new FixtureEmbeddingProvider(), true);
    await index.listRecentSessions(5);
    await index.whenScanSettled();

    const status = await index.getStatus();
    const backlog = index.getIndexProgress().vectorBacklog;

    // The windows exist, so the backlog is what is left to do — every one.
    expect(status.retrieval_units).toBeGreaterThan(1);
    expect(backlog).toBe(status.retrieval_units - status.vectorized_units);
    expect(backlog).toBeGreaterThan(0);
  });

  it("reports no backlog when semantic search is off, however many windows are unembedded", async () => {
    // Off is the default of a fresh install. Windows without vectors are then
    // not outstanding work, and saying so put "N windows not yet vectorized"
    // on every search answer for a feature nobody had asked for.
    index = build(new NullEmbeddingProvider("not_enabled"));
    await index.listRecentSessions(5);
    await index.whenScanSettled();

    const status = await index.getStatus();
    expect(status.retrieval_units).toBeGreaterThan(1);
    expect(status.vectorized_units).toBe(0);
    expect(index.getIndexProgress().vectorBacklog).toBe(0);
    expect(status.vector_segment_backlog).toBe(0);
  });

  it("reports nothing outstanding once the windows are embedded", async () => {
    index = build(new FixtureEmbeddingProvider());
    // A hybrid search is what drives embedding.
    await index.searchSessions("token refresh", 5, undefined, "hybrid");
    await index.whenScanSettled();

    const status = await index.getStatus();
    expect(status.vectorized_units).toBeGreaterThan(0);
    // Both halves. The subtraction alone held with one window of twenty-four
    // embedded — it says the two numbers agree, not that the work finished,
    // which is what the heading claims.
    expect(status.vectorized_units).toBe(status.retrieval_units);
    expect(index.getIndexProgress().vectorBacklog).toBe(0);
    expect(index.getIndexProgress().vectorBacklog).toBe(
      status.retrieval_units - status.vectorized_units,
    );
  });
});
