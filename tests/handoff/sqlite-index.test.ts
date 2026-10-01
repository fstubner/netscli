import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { MAX_SEGMENTS_PER_UNIT } from "@xtctx/handoff/embeddings";
import { MIN_CONFIDENT_COSINE } from "@xtctx/handoff/ranking";
import type { EmbeddingProvider } from "@xtctx/handoff/embeddings";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

class FixtureScraper implements ConversationScraper {
  readonly tool = "codex";
  detectCalls = 0;
  fullSyncCalls = 0;

  constructor(private readonly chunks: ConversationChunk[]) {}

  async detect(): Promise<boolean> {
    this.detectCalls += 1;
    return true;
  }

  getStorePaths(): string[] {
    return ["fixture://codex"];
  }

  async *scrape(): AsyncIterable<ConversationChunk> {
    yield* this.fullSync();
  }

  async *fullSync(): AsyncIterable<ConversationChunk> {
    this.fullSyncCalls += 1;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }

  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }

  async saveScrapedPosition(_state: ScraperState): Promise<void> {
    return;
  }
}

class FailingScraper implements ConversationScraper {
  readonly tool = "codex";

  async detect(): Promise<boolean> {
    return true;
  }

  getStorePaths(): string[] {
    return ["fixture://codex"];
  }

  async *scrape(): AsyncIterable<ConversationChunk> {
    throw new Error("boom: transcript store unreadable");
  }

  async *fullSync(): AsyncIterable<ConversationChunk> {
    throw new Error("boom: transcript store unreadable");
  }

  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }

  async saveScrapedPosition(_state: ScraperState): Promise<void> {
    return;
  }
}

class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  embeddedTexts = 0;

  constructor(model = "fixture-embedding") {
    this.model = model;
  }

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.embeddedTexts += texts.length;
    return texts.map((text) => fixtureVector(text));
  }
}

describe("SqliteHandoffIndex", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-index-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("indexes lazily and preserves same-timestamp messages", async () => {
    const scraper = new FixtureScraper([
      chunk("same-time-session", 0, "user", "first message"),
      chunk("same-time-session", 1, "assistant", "second message"),
    ]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ]);

    const recent = await index.listRecentSessions(5);
    const detail = await index.getSessionDetail("codex:same-time-session", 0, 10);

    expect(scraper.fullSyncCalls).toBe(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].message_count).toBe(2);
    expect(detail.map((message) => message.content)).toEqual([
      "first message",
      "second message",
    ]);

    await index.close();
  });

  it("discards vectors from a previously configured embedding model", async () => {
    // Changing the default model orphans every vector the old one built.
    // Reads filter on `model` so the stale rows are inert, but nothing
    // deleted them, and they would sit in the index for good — a second
    // whole copy of the corpus, growing by one more on every model change.
    const dbPath = join(tempDir, "xtctx.db");
    const chunks = [
      chunk("switch-session", 0, "user", "investigate token refresh regression"),
      chunk("switch-session", 1, "assistant", "patched the auth callback"),
    ];

    const before = new SqliteHandoffIndex(
      dbPath,
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper(chunks) }],
      { embeddingProvider: new FixtureEmbeddingProvider("old-model") },
    );
    await before.searchSessions("token", 5, undefined, "hybrid");
    const vectorsBefore = (await before.getStatus()).vectorized_units;
    await before.close();
    expect(vectorsBefore).toBeGreaterThan(0);

    const after = new SqliteHandoffIndex(
      dbPath,
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper(chunks) }],
      { embeddingProvider: new FixtureEmbeddingProvider("new-model") },
    );
    // Counted before re-embedding, so this is the leftovers and nothing else.
    const stale = (await after.getStatus()).vectorized_units;
    // Rebuilding under the new model has to still work afterwards.
    await after.searchSessions("token", 5, undefined, "hybrid");
    const rebuilt = (await after.getStatus()).vectorized_units;
    await after.close();

    expect(stale).toBe(0);
    expect(rebuilt).toBe(vectorsBefore);
  });

  it("caps how many segments one window contributes to its vector", async () => {
    // The cap lives in embeddings.ts and is applied here; a unit test of the
    // function alone stayed green with the call site unwired, which is the
    // half that matters. A window is mean-pooled, so an enormous one cost
    // hundreds of embeddings to produce one averaged vector — the largest in
    // this project's real index split into 392 segments.
    class RecordingProvider implements EmbeddingProvider {
      readonly model = "recording";
      largestBatch = 0;

      async embed(text: string): Promise<Float32Array> {
        const [vector] = await this.embedBatch([text]);
        return vector;
      }

      async embedBatch(texts: string[]): Promise<Float32Array[]> {
        this.largestBatch = Math.max(this.largestBatch, texts.length);
        return texts.map((text) => fixtureVector(text));
      }
    }

    // One window, far past the cap: 60 segments' worth of distinct lines.
    const huge = Array.from(
      { length: 60 },
      (_, index) => `${"x".repeat(1000)} line${index}`,
    ).join("\n");
    const provider = new RecordingProvider();
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper([chunk("huge-session", 0, "user", huge)]) }],
      { embeddingProvider: provider, windowSize: 2, windowStride: 1 },
    );

    await index.searchSessions("line0", 5, undefined, "hybrid");
    await index.close();

    // One window is embedded per batch here, so the largest batch seen is that
    // window's segment count.
    expect(provider.largestBatch).toBeGreaterThan(0);
    expect(provider.largestBatch).toBeLessThanOrEqual(MAX_SEGMENTS_PER_UNIT);
  });

  it("searches indexed transcript content through SQLite FTS", async () => {
    const scraper = new FixtureScraper([
      chunk("search-session", 0, "user", "investigate token refresh regression"),
      chunk("search-session", 1, "assistant", "patched the auth callback"),
    ]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ]);

    const results = await index.searchSessions("token", 5, undefined, "keyword");

    expect(results.map((session) => session.session_ref)).toEqual(["codex:search-session"]);

    await index.close();
  });

  it("keeps status bounded and does not trigger transcript indexing", async () => {
    const scraper = new FixtureScraper([
      chunk("status-session", 0, "user", "this should not be indexed by status"),
    ]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ]);

    const status = await index.getStatus();

    expect(scraper.detectCalls).toBe(1);
    expect(scraper.fullSyncCalls).toBe(0);
    expect(status.sessions).toBe(0);
    expect(status.messages).toBe(0);

    await index.close();
  });

  it("keyword search ranks by relevance, not recency", async () => {
    const scraper = new FixtureScraper([
      chunk("relevant-session", 0, "user", "sqlite sqlite sqlite deep dive", "2026-05-01T10:00:00.000Z"),
      chunk("relevant-session", 1, "assistant", "more sqlite internals and sqlite tuning", "2026-05-01T10:01:00.000Z"),
      chunk("recent-session", 0, "user", "unrelated planning notes", "2026-05-20T10:00:00.000Z"),
      chunk("recent-session", 1, "assistant", "a passing sqlite mention", "2026-05-20T10:01:00.000Z"),
    ]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ]);

    const results = await index.searchSessions("sqlite", 5, undefined, "keyword");

    expect(results.map((session) => session.session_ref)).toEqual([
      "codex:relevant-session",
      "codex:recent-session",
    ]);

    await index.close();
  });

  it("does not zero the score when only one candidate survives", async () => {
    // Semantic scores are rescaled across a query's candidates, which maps
    // the weakest to 0. With a single survivor there is nothing to rescale
    // against, and treating it as the weakest would score the only match at
    // zero and drop it below anything else.
    const scraper = new FixtureScraper([
      chunk("solo-session", 0, "user", "sqlite vector handoff"),
      chunk("solo-session", 1, "assistant", "chronological windows"),
    ]);
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper }],
      { embeddingProvider: new FixtureEmbeddingProvider(), windowSize: 8, windowStride: 8 },
    );

    const results = await index.searchSessions("sqlite vector", 5, undefined, "vector");

    expect(results).toHaveLength(1);
    expect(results[0].score ?? 0).toBeGreaterThan(0);

    await index.close();
  });

  it("returns nothing for a hybrid query with no relevance to the corpus", async () => {
    // Cosine similarity normalises to ~0.5 for unrelated content, so with
    // recency and continuity added every session scored 0.49-0.76 and was
    // returned formatted exactly like a real hit — the calling agent cannot
    // tell "nearest vector" from "actually relevant".
    const scraper = new FixtureScraper([
      chunk("corpus-session", 0, "user", "sqlite vector handoff notes"),
      chunk("corpus-session", 1, "assistant", "chronological windows"),
    ]);
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper }],
      { embeddingProvider: new FixtureEmbeddingProvider(), windowSize: 2, windowStride: 1 },
    );

    const nonsense = await index.searchSessions("SECRETLEAKCANARY", 5, undefined, "hybrid");
    const real = await index.searchSessions("sqlite vector", 5, undefined, "hybrid");

    expect(nonsense).toEqual([]);
    expect(real.map((session) => session.session_ref)).toEqual(["codex:corpus-session"]);

    await index.close();
  });

  it("does not match on xtctx's own window scaffolding", async () => {
    // Retrieval windows are wrapped in "Session: …", "Turn 1/2 |
    // message_index=0 | user @ …" headers that give the embedding model
    // ordering context. Indexing that text for keyword search meant
    // searching `message_index` or a tool name matched every session.
    const scraper = new FixtureScraper([
      chunk("scaffold-session", 0, "user", "we discussed pricing tiers"),
      chunk("scaffold-session", 1, "assistant", "and the renewal flow"),
    ]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ]);

    expect(await index.searchSessions("message_index", 5, undefined, "keyword")).toEqual([]);
    expect(await index.searchSessions("Chronological", 5, undefined, "keyword")).toEqual([]);
    // Real transcript text still matches.
    expect(
      (await index.searchSessions("pricing", 5, undefined, "keyword")).map((s) => s.session_ref),
    ).toEqual(["codex:scaffold-session"]);

    await index.close();
  });

  it("looks up a session by ref regardless of recency", async () => {
    const scraper = new FixtureScraper([
      chunk("lookup-session", 0, "user", "find me by ref"),
    ]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ]);

    const found = await index.getSessionByRef("codex:lookup-session");
    const missing = await index.getSessionByRef("codex:no-such-session");

    expect(found?.session_ref).toBe("codex:lookup-session");
    expect(found?.message_count).toBe(1);
    expect(missing).toBeNull();

    await index.close();
  });

  it("does not re-embed unchanged windows when a session is re-indexed", async () => {
    const provider = new FixtureEmbeddingProvider();
    const chunks = [
      chunk("stable-session", 0, "user", "alpha sqlite message"),
      chunk("stable-session", 1, "assistant", "beta vector message"),
      chunk("stable-session", 2, "user", "gamma handoff message"),
    ];
    const dbPath = join(tempDir, "xtctx.db");
    const options = { embeddingProvider: provider, windowSize: 2, windowStride: 1 };

    const first = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper(chunks) },
    ], options);
    await first.searchSessions("sqlite", 5, undefined, "vector");
    await first.close();
    const afterFirst = provider.embeddedTexts;

    const second = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper(chunks) },
    ], options);
    await second.searchSessions("sqlite", 5, undefined, "vector");
    await second.close();

    // The second search re-indexes identical content, so only the query
    // itself should be embedded — never the unchanged windows.
    expect(provider.embeddedTexts).toBe(afterFirst + 1);
  });

  it("re-indexing the same content leaves all counts unchanged", async () => {
    const chunks = [
      chunk("idem-session", 0, "user", "alpha message"),
      chunk("idem-session", 1, "assistant", "beta message"),
    ];
    const dbPath = join(tempDir, "xtctx.db");

    const first = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper(chunks) },
    ]);
    await first.listRecentSessions(5);
    const statusFirst = await first.getStatus();
    await first.close();

    const second = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper(chunks) },
    ]);
    await second.listRecentSessions(5);
    const statusSecond = await second.getStatus();
    await second.close();

    expect(statusSecond.sessions).toBe(statusFirst.sessions);
    expect(statusSecond.messages).toBe(statusFirst.messages);
    expect(statusSecond.retrieval_units).toBe(statusFirst.retrieval_units);
  });

  it("surfaces an embedding failure instead of silently degrading to keyword", async () => {
    class BrokenEmbeddingProvider {
      readonly model = "broken-embedding";
      async embed(): Promise<Float32Array> {
        throw new Error("embedding model unavailable");
      }
      async embedBatch(): Promise<Float32Array[]> {
        throw new Error("embedding model unavailable");
      }
    }

    const scraper = new FixtureScraper([
      chunk("degraded-session", 0, "user", "sqlite handoff notes"),
    ]);
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper }],
      { embeddingProvider: new BrokenEmbeddingProvider() },
    );

    // Hybrid still answers from keyword, but the failure must not be silent.
    const results = await index.searchSessions("sqlite", 5, undefined, "hybrid");
    const status = await index.getStatus();

    expect(results.length).toBeGreaterThan(0);
    expect(status.embedding_error).toContain("embedding model unavailable");

    await index.close();
  });

  it("rebuilds a corrupt index database instead of crashing", async () => {
    const dbPath = join(tempDir, "xtctx.db");
    await writeFile(dbPath, "this is not a sqlite database", "utf-8");
    const scraper = new FixtureScraper([chunk("recovered-session", 0, "user", "hello again")]);
    const index = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);

    const recent = await index.listRecentSessions(5);

    expect(recent).toHaveLength(1);
    expect(recent[0].session_ref).toBe("codex:recovered-session");

    await index.close();
  });

  it("clears scraper cursors when the index file was deleted, not just corrupted", async () => {
    // Deleting the db is the recovery the docs actively invite ("can always
    // be deleted and rebuilt"). A missing file opens cleanly, so the
    // corrupt-path cursor reset never ran: the fresh index was topped up from
    // each stale cursor forward and older sessions vanished with no warning.
    const dbPath = join(tempDir, "xtctx.db");
    const cursorPath = join(tempDir, "codex-state.json");
    await writeFile(
      cursorPath,
      JSON.stringify({ lastTimestamp: "2030-01-01T00:00:00.000Z" }),
      "utf-8",
    );

    const index = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper([chunk("s", 0, "user", "hi")]) },
    ]);
    await index.listRecentSessions(5);

    await expect(readFile(cursorPath, "utf-8")).rejects.toThrow();

    await index.close();
  });

  it("sets an index it cannot open aside instead of deleting it", async () => {
    // The index keeps sessions whose transcripts are gone -- Claude Code
    // deletes them after 30 days by default -- so an index that will not open
    // may hold history that exists nowhere else. It used to be deleted, on
    // corruption and on every schema version change alike.
    const dbPath = join(tempDir, "xtctx.db");
    await writeFile(dbPath, "this is not a sqlite database", "utf-8");

    const index = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper([chunk("s", 0, "user", "hi")]) },
    ]);
    const sessions = await index.listRecentSessions(5);
    await index.close();

    // A fresh index was built and works...
    expect(sessions.map((session) => session.session_ref)).toEqual(["codex:s"]);
    // ...and the old file is still there, byte for byte, beside it.
    const aside = (await readdir(tempDir)).filter((name) => name.startsWith("xtctx.db.set-aside-"));
    expect(aside).toHaveLength(1);
    await expect(readFile(join(tempDir, aside[0] as string), "utf-8")).resolves.toBe(
      "this is not a sqlite database",
    );
  });

  it("clears scraper cursors when it rebuilds, so no history is skipped", async () => {
    // A rebuilt index starts empty, but a surviving cursor means each scraper
    // only tops up from its last position forward — sessions still on disk
    // vanish silently. `setup --repair` clears the whole state dir; the
    // automatic path must not be lossier than the documented manual one.
    const dbPath = join(tempDir, "xtctx.db");
    const cursorPath = join(tempDir, "codex-state.json");
    await writeFile(dbPath, "this is not a sqlite database", "utf-8");
    await writeFile(
      cursorPath,
      JSON.stringify({ lastTimestamp: "2030-01-01T00:00:00.000Z" }),
      "utf-8",
    );

    const index = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper([chunk("s", 0, "user", "hi")]) },
    ]);
    await index.listRecentSessions(5);

    await expect(readFile(cursorPath, "utf-8")).rejects.toThrow();

    await index.close();
  });

  it("sets aside an older index whose shape no migration recognises, and rebuilds", async () => {
    const dbPath = join(tempDir, "xtctx.db");
    const Database = (await import("better-sqlite3")).default;
    const legacy = new Database(dbPath);
    legacy.exec("CREATE TABLE sessions (session_ref TEXT PRIMARY KEY)");
    legacy.pragma("user_version = 1");
    legacy.close();

    const scraper = new FixtureScraper([chunk("fresh-session", 0, "user", "fresh start")]);
    const index = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper }]);

    const recent = await index.listRecentSessions(5);
    await index.close();

    expect(recent).toHaveLength(1);
    expect(recent[0].session_ref).toBe("codex:fresh-session");
    const aside = (await readdir(tempDir)).filter((name) => /^xtctx\.db\.set-aside-[^.]+$/.test(name));
    expect(aside).toHaveLength(1);
  });

  it("refuses an index from a newer schema and leaves it where it is", async () => {
    // Setting it aside would hide the newer xtctx's history from it, and two
    // installed versions sharing one index would each set the other's aside
    // on every start.
    const dbPath = join(tempDir, "xtctx.db");
    const Database = (await import("better-sqlite3")).default;
    const newer = new Database(dbPath);
    newer.exec("CREATE TABLE sessions (session_ref TEXT PRIMARY KEY)");
    newer.pragma("user_version = 999");
    newer.close();

    const index = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper([chunk("s", 0, "user", "hi")]) },
    ]);
    await expect(index.listRecentSessions(5)).rejects.toThrow(/newer than this xtctx supports/);
    await index.close();

    expect((await readdir(tempDir)).filter((name) => name.includes("set-aside"))).toEqual([]);
    const check = new Database(dbPath, { readonly: true });
    expect(check.pragma("user_version", { simple: true })).toBe(999);
    check.close();
  });

  it(
    "opens a populated index while another server holds the write lock",
    async () => {
      // Opening must not need the write lock at all: every open used to run
      // a DELETE of stale vectors, which waited out the busy timeout behind
      // any other server's write even when there was nothing to delete.
      const dbPath = join(tempDir, "xtctx.db");
      const first = new SqliteHandoffIndex(dbPath, tempDir, [
        { tool: "codex", scraper: new FixtureScraper([chunk("s", 0, "user", "hi")]) },
      ]);
      await first.listRecentSessions(5);
      await first.close();

      const Database = (await import("better-sqlite3")).default;
      const holder = new Database(dbPath);
      holder.exec("BEGIN IMMEDIATE");
      try {
        const index = new SqliteHandoffIndex(dbPath, tempDir, [
          { tool: "codex", scraper: new FixtureScraper([]) },
        ]);
        const started = Date.now();
        const sessions = await index.listIndexedSessions(5);
        expect(sessions.map((session) => session.session_ref)).toEqual(["codex:s"]);
        expect(Date.now() - started).toBeLessThan(3000);
        await index.close();
      } finally {
        holder.exec("COMMIT");
        holder.close();
      }
    },
    30_000,
  );

  it("sets aside an index whose data pages are damaged, not just its header", async () => {
    // The first page is fine, so the file opens; the damage only shows on
    // the first read, which used to run outside the set-aside handling and
    // failed every call, leaking a handle each time.
    const dbPath = join(tempDir, "xtctx.db");
    const chunks = Array.from({ length: 400 }, (_, i) => chunk(`s${i}`, 0, "user", `message ${i} `.repeat(20)));
    const first = new SqliteHandoffIndex(dbPath, tempDir, [{ tool: "codex", scraper: new FixtureScraper(chunks) }]);
    await first.listRecentSessions(5);
    await first.close();
    const bytes = await readFile(dbPath);
    bytes.fill(0xa5, 4096);
    await writeFile(dbPath, bytes);

    const index = new SqliteHandoffIndex(dbPath, tempDir, [
      { tool: "codex", scraper: new FixtureScraper([chunk("fresh", 0, "user", "hi")]) },
    ]);
    const sessions = await index.listRecentSessions(5);
    await index.close();

    expect(sessions.map((session) => session.session_ref)).toEqual(["codex:fresh"]);
    expect((await readdir(tempDir)).filter((name) => /^xtctx\.db\.set-aside-[^.]+$/.test(name))).toHaveLength(1);
  });

  it(
    "does not set the index aside when another server holds the write lock, and retries",
    async () => {
      // With one server per MCP client, another server writing is the normal
      // case. An open that waited out the busy timeout behind it used to set
      // the live index aside (on macOS and Linux, from under the servers
      // still writing to it) and then fail every call for the server's life.
      const dbPath = join(tempDir, "xtctx.db");
      const Database = (await import("better-sqlite3")).default;
      const holder = new Database(dbPath);
      holder.pragma("journal_mode = WAL");
      // An empty file: opening it has to create the schema, which needs the
      // write lock the holder has.
      holder.exec("BEGIN IMMEDIATE");

      const index = new SqliteHandoffIndex(dbPath, tempDir, [
        { tool: "codex", scraper: new FixtureScraper([chunk("s", 0, "user", "hi")]) },
      ]);
      await expect(index.listIndexedSessions(5)).rejects.toThrow(/locked|busy/i);
      expect((await readdir(tempDir)).filter((name) => name.includes("set-aside"))).toEqual([]);

      holder.exec("COMMIT");
      holder.close();

      // The next call opens it; the server is not dead for its lifetime.
      await expect(index.listIndexedSessions(5)).resolves.toEqual([]);
      await index.close();

      // No handle from the failed attempt is still open. On Windows an open
      // handle blocks the rename; elsewhere this cannot fail, and the leak
      // matters less there.
      const { rename } = await import("node:fs/promises");
      await rename(dbPath, `${dbPath}.moved`);
      await rename(`${dbPath}.moved`, dbPath);
    },
    30_000,
  );

  it("surfaces scraper failures in status instead of hiding them", async () => {
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper: new FailingScraper() },
    ]);

    await index.listRecentSessions(5);
    const status = await index.getStatus();

    const tool = status.tools.find((entry) => entry.tool === "codex");
    expect(tool?.last_error).toContain("boom");

    await index.close();
  });

  it("semantic search embeds chronological transcript windows", async () => {
    const scraper = new FixtureScraper([
      chunk("semantic-session", 0, "user", "initial idea: use an external vector store"),
      chunk("semantic-session", 1, "assistant", "switch to sqlite vector storage"),
      chunk("semantic-session", 2, "user", "final state: chronological handoff windows"),
    ]);
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper }],
      {
        embeddingProvider: new FixtureEmbeddingProvider(),
        windowSize: 2,
        windowStride: 1,
      },
    );

    const results = await index.searchSessions("chronological sqlite vector", 5, undefined, "vector");
    const [match] = results[0].matches ?? [];
    const status = await index.getStatus();

    expect(results[0]).toMatchObject({
      session_ref: "codex:semantic-session",
      retrieval: "vector",
    });
    expect(match).toMatchObject({
      message_start_index: 1,
      message_end_index: 2,
    });
    expect(status.retrieval_units).toBe(2);
    expect(status.vectorized_units).toBe(2);
    expect(status.vector_model).toBe("fixture-embedding");

    await index.close();
  });
});

function chunk(
  sessionId: string,
  messageIndex: number,
  role: ConversationChunk["role"],
  content: string,
  timestamp = "2026-05-10T10:00:00.000Z",
): ConversationChunk {
  return {
    tool: "codex",
    sessionId,
    timestamp: new Date(timestamp),
    role,
    content,
    metadata: {
      messageIndex,
      tokenEstimate: 1,
      layer: 0,
    },
  };
}

function fixtureVector(text: string): Float32Array {
  const dimensions = [
    "token",
    "auth",
    "sqlite",
    "vector",
    "chronological",
    "handoff",
    "external",
  ];
  const normalized = text.toLowerCase();
  const vector = new Float32Array(dimensions.length);
  dimensions.forEach((term, index) => {
    vector[index] = normalized.includes(term) ? 1 : 0;
  });

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

/**
 * A scan reads every transcript store on the machine. On a real one that is
 * 55 seconds cold — 18GB of codex history alone — and it used to happen inside
 * the caller's first tool call. MCP servers are spawned per agent session, so
 * that cost is paid on every handoff, and hosts with a 30s tool timeout lose
 * the product entirely on the first call.
 *
 * The scan still runs to completion; the caller just stops waiting for all of
 * it. Work already committed stays committed, so each call resumes from where
 * the last one got to rather than starting over.
 */
describe("scan time budget", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-budget-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  class SlowScraper extends FixtureScraper {
    constructor(chunks: ConversationChunk[], private readonly delayMs: number) {
      super(chunks);
    }

    override async *fullSync(): AsyncIterable<ConversationChunk> {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      yield* super.fullSync();
    }
  }

  /**
   * A scraper that starts, then waits for the test to let it finish.
   *
   * The point of the test below is ordering — the read returns while the scan
   * is still going — and it used to assert that by racing a 400ms sleep
   * against a 300ms wall-clock ceiling. That is a coin toss on a loaded CI
   * runner, and it came up tails: 320ms on ubuntu, green on the two other
   * platforms and on eight consecutive local runs. A test that fails on
   * machine speed rather than on behaviour teaches everyone to press re-run,
   * which is how a real intermittent failure gets waved through.
   *
   * With a gate the ordering is structural: the scan cannot have finished,
   * because nothing but this test can finish it.
   */
  class GatedScraper extends FixtureScraper {
    private releaseGate!: () => void;
    private markStarted!: () => void;
    /** Resolves once `fullSync` has actually been entered. */
    readonly started = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
    private readonly gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });

    override async *fullSync(): AsyncIterable<ConversationChunk> {
      this.markStarted();
      await this.gate;
      yield* super.fullSync();
    }

    /** Let the scan run to completion. */
    finish(): void {
      this.releaseGate();
    }
  }

  it("returns before a slow scan finishes, and says the index is still filling", async () => {
    const scraper = new GatedScraper([chunk("slow-session", 0, "user", "eventually indexed")]);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ], { refreshBudgetMs: 30 });

    try {
      const recent = await index.listRecentSessions(5);

      // The scan is genuinely under way — without this the assertions below
      // would also pass for a scan that never started at all.
      await scraper.started;
      // ...and genuinely unfinished, because the gate is still closed.
      expect(recent).toEqual([]);
      expect(index.isScanning()).toBe(true);

      // The other half: once it is allowed to finish, the data is there. This
      // is what makes the empty answer above "not yet" rather than "never".
      scraper.finish();
      await index.whenScanSettled();
      expect(index.isScanning()).toBe(false);
      expect(await index.listRecentSessions(5)).toHaveLength(1);
    } finally {
      // `close()` waits for the scan to settle, so a failed assertion above
      // would otherwise hang the suite on a gate nobody opened.
      scraper.finish();
      await index.close();
    }
  });

  it("has the data once the scan it started has finished", async () => {
    const scraper = new SlowScraper([chunk("slow-session", 0, "user", "eventually indexed")], 50);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ], { refreshBudgetMs: 5 });

    await index.listRecentSessions(5);
    await index.whenScanSettled();

    // The scan ran once and completed; nothing was lost by not waiting.
    expect(scraper.fullSyncCalls).toBe(1);
    expect(index.isScanning()).toBe(false);

    await index.close();
  });

  it("waits for the whole scan when the budget is generous", async () => {
    const scraper = new SlowScraper([chunk("quick-session", 0, "user", "indexed inline")], 10);
    const index = new SqliteHandoffIndex(join(tempDir, "xtctx.db"), tempDir, [
      { tool: "codex", scraper },
    ], { refreshBudgetMs: 5_000 });

    const recent = await index.listRecentSessions(5);

    expect(recent.map((session) => session.session_ref)).toEqual(["codex:quick-session"]);
    expect(index.isScanning()).toBe(false);

    await index.close();
  });
});

/**
 * The first semantic search blocked for nine minutes on a real index: it
 * vectorized every window in the corpus inside one tool call, with no cap and
 * no progress. Vectors are worth building, but not all at once while an agent
 * waits — each batch commits, so the work carries over to the next call.
 */
describe("vectorization time budget", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-vecbudget-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  class SlowEmbeddingProvider {
    readonly model = "slow-test-model";
    batches = 0;

    async embed(text: string): Promise<Float32Array> {
      const [vector] = await this.embedBatch([text]);
      return vector;
    }

    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      this.batches += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return texts.map(() => Float32Array.from([1, 0, 0]));
    }
  }

  function manyChunks(count: number): ConversationChunk[] {
    return Array.from({ length: count }, (_, i) =>
      chunk(`vec-session-${i}`, 0, "user", `distinct window content number ${i}`),
    );
  }

  it("stops vectorizing when the budget runs out instead of doing the whole corpus", async () => {
    const provider = new SlowEmbeddingProvider();
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper(manyChunks(300)) }],
      { embeddingProvider: provider, refreshBudgetMs: 5_000, vectorBudgetMs: 80 },
    );

    await index.searchSessions("distinct window", 5, undefined, "vector");
    const vectorized = (await index.getStatus()).vectorized_units;

    // Without a budget this embeds every window before answering.
    expect(vectorized).toBeGreaterThan(0);
    expect(vectorized).toBeLessThan(300);

    await index.close();
  });

  it("keeps the vectors it already built and adds more on the next call", async () => {
    const provider = new SlowEmbeddingProvider();
    const index = new SqliteHandoffIndex(
      join(tempDir, "xtctx.db"),
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper(manyChunks(300)) }],
      { embeddingProvider: provider, refreshBudgetMs: 5_000, vectorBudgetMs: 80 },
    );

    await index.searchSessions("distinct window", 5, undefined, "vector");
    const afterFirst = (await index.getStatus()).vectorized_units;

    await index.searchSessions("distinct window", 5, undefined, "vector");
    const afterSecond = (await index.getStatus()).vectorized_units;

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBeGreaterThan(afterFirst);

    await index.close();
  });
});

/**
 * The reported score used to be the candidate's rank within its own query, not
 * how good the match was: every query's best survivor was rescaled to exactly
 * 1.0, so three nonsense words scored 0.901 against a genuine query's 0.872.
 * An agent reading that number had no way to tell a find from a shrug.
 */
describe("search scores mean similarity", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-score-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Places the document on one axis and the query at a chosen angle to it. */
  class AngledEmbeddingProvider {
    readonly model = "angled-test-model";

    constructor(private readonly queryCosine: number) {}

    async embed(text: string): Promise<Float32Array> {
      const [vector] = await this.embedBatch([text]);
      return vector;
    }

    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) =>
        text.includes("QUERY")
          ? Float32Array.from([this.queryCosine, Math.sqrt(1 - this.queryCosine ** 2)])
          : Float32Array.from([1, 0]),
      );
    }
  }

  async function searchWith(queryCosine: number) {
    const index = new SqliteHandoffIndex(
      join(tempDir, `score-${queryCosine}.db`),
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper([chunk("scored", 0, "user", "indexed body")]) }],
      { embeddingProvider: new AngledEmbeddingProvider(queryCosine), refreshBudgetMs: 5_000 },
    );

    const results = await index.searchSessions("QUERY", 5, undefined, "vector");
    await index.close();
    return results;
  }

  it("reports the similarity itself, not the best survivor rescaled to 1", async () => {
    // Derived from the threshold rather than written as a literal. This was
    // 0.6, which cleared MiniLM's 0.36 confidence floor; moving the default
    // model to bge-small raised that floor to 0.64 and the single result this
    // asserts on was filtered out before it could be scored, so a test about
    // score REPORTING failed for a reason that had nothing to do with scoring.
    const cosine = Math.min(0.99, MIN_CONFIDENT_COSINE + 0.1);
    const results = await searchWith(cosine);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(cosine, 2);
  });

  it("finds nothing when nothing is actually similar", async () => {
    // Below the confidence bar: the nearest vector is not a match just because
    // it is the nearest.
    expect(await searchWith(0.2)).toEqual([]);
  });
});

/**
 * Which branch a session ran on is recorded by the tool at the time. Asking
 * git during indexing would answer for today instead — indexing happens long
 * after the session, often after a branch switch — so the index carries what
 * the transcript said and nothing else.
 */
describe("git provenance", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-git-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function branchChunk(sessionId: string, index: number, gitBranch?: string): ConversationChunk {
    const base = chunk(sessionId, index, "user", `work item ${index}`);
    return { ...base, metadata: { ...base.metadata, gitBranch, gitCommit: gitBranch && "abc1234" } };
  }

  it("reports the branch the session recorded", async () => {
    const index = new SqliteHandoffIndex(
      join(tempDir, "git.db"),
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper([branchChunk("on-branch", 0, "feat/thing")]) }],
      { refreshBudgetMs: 5_000 },
    );

    const [session] = await index.listRecentSessions(5);

    expect(session.git_branch).toBe("feat/thing");
    expect(session.git_commit).toBe("abc1234");

    await index.close();
  });

  it("leaves it unset for a tool that does not record one", async () => {
    const index = new SqliteHandoffIndex(
      join(tempDir, "nogit.db"),
      tempDir,
      [{ tool: "codex", scraper: new FixtureScraper([branchChunk("no-branch", 0)]) }],
      { refreshBudgetMs: 5_000 },
    );

    const [session] = await index.listRecentSessions(5);

    expect(session.git_branch).toBeUndefined();

    await index.close();
  });

  it("filters to the branches asked for", async () => {
    const index = new SqliteHandoffIndex(
      join(tempDir, "filter.db"),
      tempDir,
      [
        {
          tool: "codex",
          scraper: new FixtureScraper([
            branchChunk("on-main", 0, "main"),
            branchChunk("on-feature", 1, "feat/thing"),
            branchChunk("no-branch-at-all", 2),
          ]),
        },
      ],
      { refreshBudgetMs: 5_000 },
    );

    const filtered = await index.listRecentSessions(10, undefined, ["feat/thing"]);

    // A session with no recorded branch is not evidence that it was on this
    // one, so it is excluded rather than assumed.
    expect(filtered.map((session) => session.session_ref)).toEqual(["codex:on-feature"]);

    await index.close();
  });

  it("keeps the branch a session started on when later records omit it", async () => {
    const index = new SqliteHandoffIndex(
      join(tempDir, "partial.db"),
      tempDir,
      [
        {
          tool: "codex",
          scraper: new FixtureScraper([
            branchChunk("mixed", 0, "feat/thing"),
            branchChunk("mixed", 1),
          ]),
        },
      ],
      { refreshBudgetMs: 5_000 },
    );

    const [session] = await index.listRecentSessions(5);

    expect(session.git_branch).toBe("feat/thing");

    await index.close();
  });
});
