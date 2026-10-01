import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";
import type { OpenCodeChunk } from "@xtctx/types/scraper";

/**
 * opencode stores conversations in a single SQLite database with three
 * tables: session, message, part. The scraper joins by session_id and
 * message_id, then concatenates type === "text" parts to form the chunk
 * content. Tool parts become a line of their own; reasoning, file and step
 * parts are skipped silently.
 */

interface SessionFixture {
  id: string;
  title?: string;
  directory?: string;
  time_created: number;
  messages: MessageFixture[];
}

interface MessageFixture {
  id: string;
  role: "user" | "assistant" | "system";
  time_created: number;
  agent?: string;
  modelID?: string;
  providerID?: string;
  parts: PartFixture[];
}

interface PartFixture {
  id: string;
  time_created: number;
  data: Record<string, unknown>;
}

function buildOpenCodeDb(dbPath: string, sessions: SessionFixture[]): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workspace_id TEXT,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      path TEXT,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_compacting INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  const insSession = db.prepare(
    `INSERT INTO session (id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url, time_created, time_updated, time_compacting, time_archived)
     VALUES (?, 'p1', NULL, NULL, 's', ?, NULL, ?, '0.1', NULL, ?, ?, NULL, NULL)`,
  );
  const insMessage = db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`,
  );
  const insPart = db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  );

  for (const s of sessions) {
    insSession.run(s.id, s.directory ?? "/tmp", s.title ?? "untitled", s.time_created, s.time_created);
    for (const m of s.messages) {
      const msgData: Record<string, unknown> = {
        id: m.id,
        sessionID: s.id,
        role: m.role,
        agent: m.agent ?? "build",
        time: { created: m.time_created },
      };
      if (m.role === "assistant") {
        msgData.modelID = m.modelID ?? "claude-3-5-sonnet";
        msgData.providerID = m.providerID ?? "anthropic";
      }
      insMessage.run(m.id, s.id, m.time_created, m.time_created, JSON.stringify(msgData));
      for (const p of m.parts) {
        insPart.run(p.id, m.id, s.id, p.time_created, JSON.stringify(p.data));
      }
    }
  }
  db.close();
}

describe("OpenCodeScraper", () => {
  let rootDir = "";
  let stateDir = "";
  let dbPath = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-opencode-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-state-"));
    dbPath = join(rootDir, "opencode.db");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("scopes sessions to the project root when provided", async () => {
    buildOpenCodeDb(dbPath, [
      {
        id: "ses-in",
        directory: "/work/myproj",
        time_created: 1_750_000_000_000,
        messages: [
          {
            id: "msg-in",
            role: "user",
            time_created: 1_750_000_000_000,
            parts: [{ id: "prt-in", time_created: 1_750_000_000_000, data: { type: "text", text: "inside" } }],
          },
        ],
      },
      {
        id: "ses-out",
        directory: "/work/otherproj",
        time_created: 1_750_000_000_000,
        messages: [
          {
            id: "msg-out",
            role: "user",
            time_created: 1_750_000_000_000,
            parts: [{ id: "prt-out", time_created: 1_750_000_000_000, data: { type: "text", text: "outside" } }],
          },
        ],
      },
    ]);

    const scraper = new OpenCodeScraper(dbPath, stateDir, "/work/myproj");
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("inside");
    expect(chunks[0].sessionId).toBe("ses-in");
  });

  it("reports a corrupt database instead of looking empty", async () => {
    // A store that exists but cannot be opened is a broken tool, not a
    // pristine one. Swallowing it made `status` read "detected, 0 sessions",
    // indistinguishable from a fresh install, so a corrupt store could go
    // unnoticed indefinitely.
    await writeFile(dbPath, "this is not a sqlite database", "utf-8");
    const scraper = new OpenCodeScraper(dbPath, stateDir);

    expect(await scraper.detect()).toBe(true);
    await expect(async () => {
      const chunks: OpenCodeChunk[] = [];
      for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    }).rejects.toThrow(/opencode database/i);
  });

  it("returns no chunks when database file is missing", async () => {
    const scraper = new OpenCodeScraper(join(rootDir, "missing.db"), stateDir);
    expect(await scraper.detect()).toBe(false);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    expect(chunks).toHaveLength(0);
  });

  it("returns no chunks when database is empty", async () => {
    buildOpenCodeDb(dbPath, []);
    const scraper = new OpenCodeScraper(dbPath, stateDir);
    expect(await scraper.detect()).toBe(true);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    expect(chunks).toHaveLength(0);
  });

  it("scrapes a single session with user and assistant messages", async () => {
    buildOpenCodeDb(dbPath, [
      {
        id: "sess-1",
        time_created: new Date("2026-02-24T10:00:00Z").getTime(),
        messages: [
          {
            id: "m1",
            role: "user",
            time_created: new Date("2026-02-24T10:00:00Z").getTime(),
            parts: [
              { id: "p1", time_created: 0, data: { type: "text", text: "hello opencode" } },
            ],
          },
          {
            id: "m2",
            role: "assistant",
            time_created: new Date("2026-02-24T10:00:05Z").getTime(),
            modelID: "gpt-4",
            providerID: "openai",
            parts: [
              { id: "p2", time_created: 0, data: { type: "reasoning", text: "internal" } },
              { id: "p3", time_created: 1, data: { type: "text", text: "hi user" } },
            ],
          },
        ],
      },
    ]);

    const scraper = new OpenCodeScraper(dbPath, stateDir);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].role).toBe("user");
    expect(chunks[0].content).toBe("hello opencode");
    expect(chunks[0].sessionId).toBe("sess-1");
    expect(chunks[0].metadata.messageIndex).toBe(0);

    expect(chunks[1].role).toBe("assistant");
    expect(chunks[1].content).toBe("hi user"); // reasoning skipped
    expect(chunks[1].metadata.model).toBe("gpt-4");
    expect(chunks[1].metadata.providerID).toBe("openai");
    expect(chunks[1].metadata.messageIndex).toBe(1);
  });

  it("concatenates multiple text parts on a single message", async () => {
    buildOpenCodeDb(dbPath, [
      {
        id: "sess-2",
        time_created: 1000,
        messages: [
          {
            id: "m1",
            role: "assistant",
            time_created: 2000,
            parts: [
              { id: "p1", time_created: 1, data: { type: "text", text: "first" } },
              { id: "p2", time_created: 2, data: { type: "tool", tool: "read" } },
              { id: "p3", time_created: 3, data: { type: "text", text: "second" } },
              { id: "p4", time_created: 4, data: { type: "file", mime: "text/plain" } },
            ],
          },
        ],
      },
    ]);

    const scraper = new OpenCodeScraper(dbPath, stateDir);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    // The text parts join; the tool part between them is a line of its own.
    expect(chunks.map((chunk) => [chunk.role, chunk.content])).toEqual([
      ["assistant", "first\nsecond"],
      ["tool", "used read"],
    ]);
  });

  it("walks multiple sessions in time order", async () => {
    buildOpenCodeDb(dbPath, [
      {
        id: "sess-A",
        time_created: 1000,
        messages: [
          {
            id: "m1",
            role: "user",
            time_created: 1000,
            parts: [{ id: "p1", time_created: 0, data: { type: "text", text: "alpha" } }],
          },
        ],
      },
      {
        id: "sess-B",
        time_created: 2000,
        messages: [
          {
            id: "m2",
            role: "user",
            time_created: 2000,
            parts: [{ id: "p2", time_created: 0, data: { type: "text", text: "bravo" } }],
          },
        ],
      },
    ]);

    const scraper = new OpenCodeScraper(dbPath, stateDir);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    expect(chunks).toHaveLength(2);
    // No `.sort()`: sorting erases the very property this test is named for,
    // so a reader returning sessions in any order passed it.
    expect(chunks.map((c) => c.sessionId)).toEqual(["sess-A", "sess-B"]);
  });

  /**
   * A session is read whole when anything in it is newer than the cursor, and
   * not at all when nothing is. Reading only the newer messages missed one
   * that was still streaming at the last scan; see opencode-session-reread.
   */
  it("respects since cursor: reads a session with newer rows whole, and skips one without", async () => {
    const t0 = new Date("2026-02-24T10:00:00Z").getTime();
    const t1 = new Date("2026-02-24T10:05:00Z").getTime();
    buildOpenCodeDb(dbPath, [
      {
        id: "sess-cut",
        time_created: t0,
        messages: [
          {
            id: "m1",
            role: "user",
            time_created: t0,
            parts: [{ id: "p1", time_created: 0, data: { type: "text", text: "before" } }],
          },
          {
            id: "m2",
            role: "assistant",
            time_created: t1,
            parts: [{ id: "p2", time_created: 0, data: { type: "text", text: "after" } }],
          },
        ],
      },
      {
        id: "sess-quiet",
        time_created: t0,
        messages: [
          {
            id: "m3",
            role: "user",
            time_created: t0,
            parts: [{ id: "p3", time_created: 0, data: { type: "text", text: "untouched" } }],
          },
        ],
      },
    ]);

    const scraper = new OpenCodeScraper(dbPath, stateDir);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.scrape(new Date(t0))) chunks.push(chunk);

    expect(chunks.map((chunk) => chunk.content)).toEqual(["before", "after"]);
  });

  it("normalizes role values", async () => {
    buildOpenCodeDb(dbPath, [
      {
        id: "sess-roles",
        time_created: 1000,
        messages: [
          {
            id: "m1",
            role: "system",
            time_created: 1000,
            parts: [{ id: "p1", time_created: 0, data: { type: "text", text: "sys" } }],
          },
        ],
      },
    ]);

    const scraper = new OpenCodeScraper(dbPath, stateDir);
    const chunks: OpenCodeChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].role).toBe("system");
  });
});
