/**
 * A transcript store whose sessions can be deleted out from under the index.
 *
 * Claude Code deletes transcripts after 30 days by default, so the index ends
 * up the only copy of older sessions. `age()` stands in for that cleanup.
 *
 * The cursor is real in the way that matters: it is a `<tool>-state.json`
 * file beside the index, which is what the index clears when it wants a full
 * re-read, and while it exists a scrape yields only what is newer than it. A
 * fixture that re-read everything on every scan could not tell a forced
 * re-read from an ordinary one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConversationChunk, ConversationScraper, ScraperState } from "@xtctx/types/scraper";

export class AgingStoreScraper implements ConversationScraper {
  private readonly sessions = new Map<string, ConversationChunk[]>();
  /** Chunks handed to the index, across every scrape. */
  yielded = 0;

  constructor(
    private readonly stateDir: string,
    readonly tool = "codex",
  ) {}

  /** Write a session's transcript; replaces any earlier one with the same id. */
  write(sessionId: string, contents: string[], options: { at?: string; gitBranch?: string } = {}): this {
    const at = Date.parse(options.at ?? "2026-05-10T10:00:00.000Z");
    this.sessions.set(
      sessionId,
      contents.map((content, index) => ({
        tool: this.tool,
        sessionId,
        timestamp: new Date(at + index * 1000),
        role: index % 2 === 0 ? "user" : "assistant",
        content,
        metadata: {
          messageIndex: index,
          tokenEstimate: 1,
          layer: 0,
          ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
        },
      })),
    );
    return this;
  }

  /** The tool cleaned this transcript up. */
  age(sessionId: string): this {
    this.sessions.delete(sessionId);
    return this;
  }

  async detect(): Promise<boolean> {
    return true;
  }

  getStorePaths(): string[] {
    return [`fixture://${this.tool}`];
  }

  async *scrape(): AsyncIterable<ConversationChunk> {
    const since = (await this.getLastScrapedPosition()).lastTimestamp.getTime();
    for (const chunks of this.sessions.values()) {
      for (const chunk of chunks) {
        if (chunk.timestamp.getTime() > since) {
          this.yielded += 1;
          yield chunk;
        }
      }
    }
  }

  async *fullSync(): AsyncIterable<ConversationChunk> {
    for (const chunks of this.sessions.values()) {
      yield* chunks;
    }
  }

  async listSessionIds(): Promise<Set<string>> {
    return new Set(this.sessions.keys());
  }

  private get cursorPath(): string {
    return join(this.stateDir, `${this.tool}-state.json`);
  }

  async getLastScrapedPosition(): Promise<ScraperState> {
    if (!existsSync(this.cursorPath)) {
      return { lastTimestamp: new Date(0) };
    }
    const saved = JSON.parse(readFileSync(this.cursorPath, "utf-8")) as { lastTimestamp: string };
    return { lastTimestamp: new Date(saved.lastTimestamp) };
  }

  async saveScrapedPosition(state: ScraperState): Promise<void> {
    writeFileSync(this.cursorPath, JSON.stringify({ lastTimestamp: state.lastTimestamp.toISOString() }));
  }
}
