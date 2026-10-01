/**
 * `xtctx_session_detail` returned the OLDEST 50 messages with no size budget.
 * The first page of real recent sessions measured 75k-206k characters, and a
 * 7,996-message session needed offset=7946 to reach its end — so a handoff,
 * which needs where the work stood, read the opening of the session and ran
 * out of context before the part it came for.
 *
 * These run the real index behind the real handler: the order, the positions
 * and the budget only mean something together.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import {
  createSessionDetailHandler,
  MAX_DETAIL_CHARS,
  MAX_TOOL_EXCERPT_CHARS,
} from "@xtctx/mcp/tools/sessions";
import type { SessionMessage } from "@xtctx/handoff/types";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

class SeedScraper implements ConversationScraper {
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
  async saveScrapedPosition(): Promise<void> {
    return;
  }
}

const REF = "codex:long-session";

function msg(
  index: number,
  content: string,
  role: ConversationChunk["role"] = "user",
): ConversationChunk {
  return {
    tool: "codex",
    sessionId: "long-session",
    timestamp: new Date(Date.UTC(2026, 4, 10, 10, 0, index)),
    role,
    content,
    metadata: { messageIndex: index, tokenEstimate: 1, layer: 0 },
  };
}

const label = (n: number) => `m${String(n).padStart(3, "0")}`;

describe("xtctx_session_detail reads the end of a session first", () => {
  let dir = "";
  let index: SqliteHandoffIndex | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-detail-tail-"));
  });

  afterEach(async () => {
    await index?.close();
    index = null;
    await rm(dir, { recursive: true, force: true });
  });

  async function handlerFor(chunks: ConversationChunk[]) {
    index = new SqliteHandoffIndex(join(dir, "xtctx.db"), dir, [
      { tool: "codex", scraper: new SeedScraper(chunks) },
    ]);
    await index.listRecentSessions(5);
    const handler = createSessionDetailHandler(index);
    return async (args: Record<string, unknown>) =>
      (await handler({ session_ref: REF, format: "json", ...args })) as {
        messages: SessionMessage[];
        omitted_for_budget: number;
      };
  }

  const hundredTwenty = () => Array.from({ length: 120 }, (_, n) => msg(n, label(n)));

  it("returns the most recent messages by default", async () => {
    const detail = await handlerFor(hundredTwenty());

    const { messages } = await detail({});

    // Oldest-first within the page, but the page is the END of the session.
    expect(messages.map((m) => m.content)).toEqual(
      Array.from({ length: 50 }, (_, n) => label(70 + n)),
    );
    expect(messages[0]?.position).toBe(70);
    expect(messages.at(-1)?.position).toBe(119);
  });

  it("keeps explicit offset paging counted from the start, all the way to message 0", async () => {
    const detail = await handlerFor(hundredTwenty());

    expect((await detail({ offset: 0 })).messages.map((m) => m.content)).toEqual(
      Array.from({ length: 50 }, (_, n) => label(n)),
    );
    expect((await detail({ offset: 70, limit: 3 })).messages.map((m) => m.content)).toEqual([
      label(70),
      label(71),
      label(72),
    ]);
  });

  it("counts offset back from the newest message when from_end is true", async () => {
    const detail = await handlerFor(hundredTwenty());

    const { messages } = await detail({ offset: 50, from_end: true });

    expect(messages.map((m) => m.content)).toEqual(
      Array.from({ length: 50 }, (_, n) => label(20 + n)),
    );
  });

  it("tells the reader how to reach the earlier messages, and the pointer works", async () => {
    const detail = await handlerFor(hundredTwenty());
    const handler = createSessionDetailHandler(index as SqliteHandoffIndex);

    const text = (await handler({ session_ref: REF })) as string;
    expect(text).toContain("positions 70-119");
    expect(text).toContain("offset=20 from_end=false");

    const earlier = await detail({ offset: 20, from_end: false });
    expect(earlier.messages.at(-1)?.content).toBe(label(69));
  });

  it("stays within the total character budget, keeping the newest messages", async () => {
    // 30 messages of 5,000 characters: 150,000 in all, as a real first page.
    const chunks = Array.from({ length: 30 }, (_, n) => msg(n, `${label(n)}${"x".repeat(4_996)}`));
    const detail = await handlerFor(chunks);

    const { messages, omitted_for_budget } = await detail({ limit: 30 });

    const total = messages.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_DETAIL_CHARS);
    expect(messages.at(-1)?.content.startsWith(label(29))).toBe(true);
    expect(omitted_for_budget).toBe(30 - messages.length);
    expect(omitted_for_budget).toBeGreaterThan(0);
  });

  it("excerpts long tool output and says how long it was", async () => {
    const detail = await handlerFor([
      msg(0, "run the build"),
      msg(1, "L".repeat(10_000), "tool"),
    ]);

    const { messages } = await detail({});

    const tool = messages.find((m) => m.role === "tool");
    expect(tool?.content.startsWith("L".repeat(MAX_TOOL_EXCERPT_CHARS))).toBe(true);
    expect(tool?.content).toContain("10000 chars");
    expect(tool?.content.length).toBeLessThan(MAX_TOOL_EXCERPT_CHARS + 100);
    // Real conversation text is not excerpted.
    expect(messages.find((m) => m.role === "user")?.content).toBe("run the build");
  });
});
