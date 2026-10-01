import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopilotScraper } from "@xtctx/scrapers/copilot";
import type { CopilotChunk } from "@xtctx/types/scraper";

/**
 * VS Code stores Copilot Chat sessions in SQLite workspaceStorage files:
 *   <workspaceStoragePath>/<hash>/state.vscdb
 *
 * The table is ItemTable with a single key "interactive.sessions".
 * The value is a JSON object mapping numeric indices to session objects:
 *   {
 *     "0": {
 *       sessionId: string,
 *       creationDate: number (unix ms),
 *       requests: [{
 *         message: { parts: [{text: string}] },
 *         response: [{value: string}],
 *         isCanceled?: boolean,
 *         model?: string,
 *         agentId?: string,
 *       }]
 *     }
 *   }
 *
 * The scraper discovers db files via glob("*\/state.vscdb").
 */

const SESSION_UUID = "copilot-session-test-uuid";

/** Creates a workspaceStorage-style SQLite db under a hash subdirectory. */
async function createWorkspaceDb(
  workspaceStorageDir: string,
  hashDir: string,
  sessions: unknown,
): Promise<string> {
  const subdir = join(workspaceStorageDir, hashDir);
  await mkdir(subdir, { recursive: true });

  const dbPath = join(subdir, "state.vscdb");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "interactive.sessions",
    JSON.stringify(sessions),
  );
  db.close();
  return dbPath;
}

describe("CopilotScraper", () => {
  let workspaceStorageDir = "";
  let stateDir = "";
  let scraper: CopilotScraper;

  // Base sessions data: two requests (one user+assistant pair each).
  const baseSessions = {
    "0": {
      sessionId: SESSION_UUID,
      creationDate: new Date("2026-02-24T10:00:00Z").getTime(),
      requests: [
        {
          message: { parts: [{ text: "copilot first" }] },
          response: [{ value: "copilot second" }],
          isCanceled: false,
          model: "gpt-4o-copilot",
        },
      ],
    },
  };

  beforeEach(async () => {
    workspaceStorageDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-ws-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-state-"));

    await createWorkspaceDb(workspaceStorageDir, "abc123hash", baseSessions);

    scraper = new CopilotScraper(workspaceStorageDir, stateDir);
  });

  afterEach(async () => {
    await rm(workspaceStorageDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("detects workspaceStorage directory", async () => {
    expect(await scraper.detect()).toBe(true);
  });

  it("returns false for non-existent path", async () => {
    const absent = new CopilotScraper(join(workspaceStorageDir, "nonexistent"), stateDir);
    expect(await absent.detect()).toBe(false);
  });

  it("reads user and assistant messages from SQLite", async () => {
    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);

    expect(chunks[0].role).toBe("user");
    expect(chunks[0].content).toBe("copilot first");
    expect(chunks[0].sessionId).toBe(SESSION_UUID);
    expect(chunks[0].metadata.model).toBe("gpt-4o-copilot");

    expect(chunks[1].role).toBe("assistant");
    expect(chunks[1].content).toBe("copilot second");
    expect(chunks[1].sessionId).toBe(SESSION_UUID);
  });

  it("limits project-scoped scrapers to matching VS Code workspace folders", async () => {
    await writeFile(
      join(workspaceStorageDir, "abc123hash", "workspace.json"),
      JSON.stringify({ folder: "file:///c%3A/some/project" }),
      "utf-8",
    );
    await createWorkspaceDb(workspaceStorageDir, "otherhash", baseSessions);
    await writeFile(
      join(workspaceStorageDir, "otherhash", "workspace.json"),
      JSON.stringify({ folder: "file:///other/project" }),
      "utf-8",
    );

    const scoped = new CopilotScraper(workspaceStorageDir, stateDir, "c:\\some\\project");
    const chunks: CopilotChunk[] = [];
    for await (const chunk of scoped.fullSync()) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content)).toEqual(["copilot first", "copilot second"]);
  });

  it("keeps the prompt of a canceled request but not its partial answer", async () => {
    const canceledSessions = {
      "0": {
        sessionId: "cancel-session",
        creationDate: new Date("2026-02-25T09:00:00Z").getTime(),
        requests: [
          {
            message: { parts: [{ text: "this was canceled" }] },
            response: [{ value: "never shown" }],
            isCanceled: true,
          },
          {
            message: { parts: [{ text: "real question" }] },
            response: [{ value: "real answer" }],
            isCanceled: false,
          },
        ],
      },
    };

    await createWorkspaceDb(workspaceStorageDir, "def456hash", canceledSessions);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    expect(chunks.find((c) => c.content === "this was canceled")?.role).toBe("user");
    expect(chunks.find((c) => c.content === "never shown")).toBeUndefined();

    const real = chunks.find((c) => c.content === "real question");
    expect(real).toBeDefined();
  });

  it("concatenates multiple text parts in user message", async () => {
    const multiPartSessions = {
      "0": {
        sessionId: "multi-part",
        creationDate: new Date("2026-02-26T08:00:00Z").getTime(),
        requests: [
          {
            message: {
              parts: [{ text: "first part" }, { text: "second part" }],
            },
            response: [{ value: "ok" }],
          },
        ],
      },
    };

    await createWorkspaceDb(workspaceStorageDir, "ghi789hash", multiPartSessions);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    const multiChunk = chunks.find((c) => c.content.startsWith("first part"));
    expect(multiChunk).toBeDefined();
    expect(multiChunk?.content).toBe("first part\nsecond part");
  });

  it("concatenates multiple response segments", async () => {
    const multiResponseSessions = {
      "0": {
        sessionId: "multi-response",
        creationDate: new Date("2026-02-26T09:00:00Z").getTime(),
        requests: [
          {
            message: { parts: [{ text: "question" }] },
            response: [{ value: "part A " }, { value: "part B" }],
          },
        ],
      },
    };

    await createWorkspaceDb(workspaceStorageDir, "jkl012hash", multiResponseSessions);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    const assistant = chunks.find((c) => c.role === "assistant" && c.sessionId === "multi-response");
    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe("part A part B");
  });

  it("discovers databases across multiple workspace hashes", async () => {
    const otherSessions = {
      "0": {
        sessionId: "other-workspace-session",
        creationDate: new Date("2026-02-27T10:00:00Z").getTime(),
        requests: [
          {
            message: { parts: [{ text: "from second workspace" }] },
            response: [{ value: "answered" }],
          },
        ],
      },
    };

    await createWorkspaceDb(workspaceStorageDir, "second-workspace-hash", otherSessions);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    // Chunks from both workspace dirs
    expect(chunks.length).toBeGreaterThan(2);
    const fromSecond = chunks.find((c) => c.content === "from second workspace");
    expect(fromSecond).toBeDefined();
    expect(fromSecond?.sessionId).toBe("other-workspace-session");
  });

  it("returns sessions at or after the since cursor on incremental scrape", async () => {
    // Base session has creationDate = 2026-02-24T10:00:00Z.
    // Passing since = 2026-02-24T10:00:00Z uses >= comparison, so the base session
    // is still returned (boundary-inclusive).
    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.scrape(new Date("2026-02-24T10:00:00Z"))) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.sessionId === SESSION_UUID)).toBe(true);
  });

  it("re-emits turns of stale sessions so late-arriving turns are not lost", async () => {
    // Copilot only stamps a session-level creationDate — individual turns
    // inherit it. If the scrape cursor filtered on creationDate, any session
    // created BEFORE the cursor but updated AFTER (new turns appended) would
    // be skipped forever, losing those turns. The scraper therefore emits
    // every turn of every session every cycle; the ingestion layer dedupes
    // by chunk-ID (which includes messageIndex, so repeat turns collapse and
    // genuinely new turns land). This test documents that contract.
    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.scrape(new Date("2026-02-25T00:00:00Z"))) {
      chunks.push(chunk);
    }

    const baseChunk = chunks.find((c) => c.sessionId === SESSION_UUID);
    expect(baseChunk).toBeDefined();
  });

  it("emits newer session turns alongside re-emitted stale-session turns", async () => {
    const newerSessions = {
      "0": {
        sessionId: "newer-session",
        creationDate: new Date("2026-02-25T12:00:00Z").getTime(),
        requests: [
          {
            message: { parts: [{ text: "newer question" }] },
            response: [{ value: "newer answer" }],
          },
        ],
      },
    };

    await createWorkspaceDb(workspaceStorageDir, "newer-ws-hash", newerSessions);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.scrape(new Date("2026-02-25T00:00:00Z"))) {
      chunks.push(chunk);
    }

    // Both sessions are emitted; upstream ingestion dedupes by chunk-ID.
    const baseChunk = chunks.find((c) => c.sessionId === SESSION_UUID);
    expect(baseChunk).toBeDefined();

    const newerChunk = chunks.find((c) => c.sessionId === "newer-session");
    expect(newerChunk).toBeDefined();
  });

  it("returns no chunks for workspace dir with no vscdb files", async () => {
    const emptyScraper = new CopilotScraper(
      await mkdtemp(join(tmpdir(), "xtctx-empty-")),
      stateDir,
    );
    const chunks: CopilotChunk[] = [];
    for await (const chunk of emptyScraper.fullSync()) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
    await rm((emptyScraper as unknown as { workspaceStoragePath: string }).workspaceStoragePath, {
      recursive: true,
      force: true,
    });
  });

  it("gracefully skips databases without interactive.sessions key", async () => {
    const subdir = join(workspaceStorageDir, "empty-db-hash");
    await mkdir(subdir, { recursive: true });
    const emptyDbPath = join(subdir, "state.vscdb");
    const emptyDb = new Database(emptyDbPath);
    emptyDb.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    emptyDb.close();

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    // Original base session should still appear
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("detects agent completionType when agentId is present", async () => {
    const agentSessions = {
      "0": {
        sessionId: "agent-session",
        creationDate: new Date("2026-02-28T08:00:00Z").getTime(),
        requests: [
          {
            message: { parts: [{ text: "run my tests" }] },
            response: [{ value: "tests passed" }],
            model: "gpt-4o-copilot",
            agentId: "@workspace",
          },
        ],
      },
    };

    await createWorkspaceDb(workspaceStorageDir, "agent-ws-hash", agentSessions);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    const agentChunk = chunks.find((c) => c.sessionId === "agent-session");
    expect(agentChunk).toBeDefined();
    expect(agentChunk?.metadata.completionType).toBe("agent");
  });
});

/**
 * VS Code writes `interactive.sessions` as an array. Every workspace checked on
 * a real machine — 64 of them, 18 holding sessions — was an array, and never
 * an object. Requiring an object meant this reader produced nothing at all
 * from real VS Code data; it only ever worked against fixtures shaped to match
 * its own assumption, which is why the suite never noticed.
 */
describe("CopilotScraper against VS Code's real container shape", () => {
  let workspaceStorageDir = "";
  let stateDir = "";
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  const arraySessions = [
    {
      sessionId: "vscode-array-session",
      creationDate: new Date("2026-02-24T10:00:00Z").getTime(),
      requests: [
        {
          message: { parts: [{ text: "a question typed into the panel" }] },
          response: [{ value: "the answer that came back" }],
          isCanceled: false,
        },
      ],
    },
  ];

  beforeEach(async () => {
    workspaceStorageDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-array-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-array-state-"));
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await rm(workspaceStorageDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("reads sessions stored as an array", async () => {
    await createWorkspaceDb(workspaceStorageDir, "arrayhash", arraySessions);
    const scraper = new CopilotScraper(workspaceStorageDir, stateDir);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      "a question typed into the panel",
      "the answer that came back",
    ]);
    expect(chunks[0].sessionId).toBe("vscode-array-session");
  });

  it("does not report the ordinary array container as drift", async () => {
    await createWorkspaceDb(workspaceStorageDir, "arrayhash", arraySessions);
    const scraper = new CopilotScraper(workspaceStorageDir, stateDir);

    for await (const chunk of scraper.fullSync()) void chunk;

    expect(warnings).toEqual([]);
  });

  it("still reports a container that is neither an object nor an array", async () => {
    await createWorkspaceDb(workspaceStorageDir, "stringhash", "not a container at all");
    const scraper = new CopilotScraper(workspaceStorageDir, stateDir);

    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    expect(chunks).toEqual([]);
    expect(warnings.join("\n")).toContain("expected interactive.sessions to be an object or array");
  });
});

/**
 * Current VS Code keeps each chat in its own file under
 * `<workspace>/chatSessions/` rather than in the `interactive.sessions` blob.
 * A reader that only opened state.vscdb therefore saw nothing from any recent
 * session — 12 workspaces on a real machine hold 24 such sessions.
 */
describe("CopilotScraper reading per-session chat files", () => {
  let workspaceStorageDir = "";
  let stateDir = "";
  let sessionsDir = "";
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  const session = {
    sessionId: "modern-session",
    creationDate: new Date("2026-02-24T10:00:00Z").getTime(),
    requests: [
      {
        message: { parts: [{ text: "how does the index get rebuilt" }] },
        response: [{ value: "it is derived, so it is dropped and re-scraped" }],
        isCanceled: false,
      },
    ],
  };

  async function collectAll(): Promise<CopilotChunk[]> {
    const scraper = new CopilotScraper(workspaceStorageDir, stateDir);
    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    return chunks;
  }

  beforeEach(async () => {
    workspaceStorageDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-files-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-files-state-"));
    // A workspace needs a database for its directory to be discovered at all.
    await createWorkspaceDb(workspaceStorageDir, "modernhash", []);
    sessionsDir = join(workspaceStorageDir, "modernhash", "chatSessions");
    await mkdir(sessionsDir, { recursive: true });
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await rm(workspaceStorageDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("reads a .json session file", async () => {
    await writeFile(join(sessionsDir, "modern-session.json"), JSON.stringify(session), "utf-8");

    const chunks = await collectAll();

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      "how does the index get rebuilt",
      "it is derived, so it is dropped and re-scraped",
    ]);
    expect(warnings).toEqual([]);
  });

  /** The newest format wraps each record under `v`, one per line. */
  /**
   * A `.jsonl` chat session is a journal, not a list of sessions: record 0 is
   * a snapshot whose `requests` array is empty, and the turns arrive as later
   * mutations. Reading it as one-session-per-line found only the snapshot and
   * reported an empty conversation — a whole chat lost in silence.
   *
   * These fixtures use the record shapes VS Code actually writes. The previous
   * test invented a shape that matched the reader's assumption, which is the
   * same way the array-container bug in this file survived.
   */
  it("replays a .jsonl journal into the conversation it records", async () => {
    const lines = [
      // Snapshot: a session with no turns yet.
      JSON.stringify({
        kind: 0,
        v: { sessionId: "journal-session", creationDate: session.creationDate, requests: [] },
      }),
      // Editor state, nothing to do with the conversation.
      JSON.stringify({ kind: 1, k: ["inputState", "inputText"], v: "" }),
      // The turn itself, appended to the requests array.
      JSON.stringify({ kind: 2, k: ["requests"], v: [{ ...session.requests[0], timestamp: 2 }] }),
      // A field set on that turn after the fact.
      JSON.stringify({ kind: 1, k: ["requests", 0, "isCanceled"], v: false }),
      "",
    ].join("\n");
    await writeFile(join(sessionsDir, "journal-session.jsonl"), lines, "utf-8");

    const chunks = await collectAll();

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      "how does the index get rebuilt",
      "it is derived, so it is dropped and re-scraped",
    ]);
    expect(chunks[0].sessionId).toBe("journal-session");
    expect(warnings).toEqual([]);
  });

  it("reports a journal with no snapshot to rebuild from", async () => {
    const lines = [JSON.stringify({ kind: 1, k: ["inputState"], v: {} }), ""].join("\n");
    await writeFile(join(sessionsDir, "headless.jsonl"), lines, "utf-8");

    expect(await collectAll()).toEqual([]);
    expect(warnings.join("\n")).toContain("no snapshot record");
  });

  it("reports a session file that cannot be parsed", async () => {
    await writeFile(join(sessionsDir, "broken.json"), "{ not json", "utf-8");

    expect(await collectAll()).toEqual([]);
    expect(warnings.join("\n")).toContain("chat session file is not valid JSON");
  });

  it("says nothing when a workspace has no chat-session directory", async () => {
    await rm(sessionsDir, { recursive: true, force: true });

    expect(await collectAll()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("ignores files that are not sessions", async () => {
    await writeFile(join(sessionsDir, "notes.txt"), "not a session", "utf-8");

    expect(await collectAll()).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

/**
 * A session with no `sessionId` used to fall back to the constant "unknown",
 * so every id-less conversation on a machine collapsed into one session with
 * colliding message indexes — unrelated chats interleaved as a single
 * transcript. The file name is the id VS Code gave it.
 */
describe("CopilotScraper identifying sessions with no sessionId", () => {
  let workspaceStorageDir = "";
  let stateDir = "";
  let sessionsDir = "";

  const turn = (text: string) => ({
    message: { parts: [{ text }] },
    response: [{ value: `answer to ${text}` }],
    isCanceled: false,
  });

  beforeEach(async () => {
    workspaceStorageDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-ids-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-ids-state-"));
    await createWorkspaceDb(workspaceStorageDir, "idhash", []);
    sessionsDir = join(workspaceStorageDir, "idhash", "chatSessions");
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspaceStorageDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("keeps two id-less conversations apart", async () => {
    await writeFile(
      join(sessionsDir, "aaaaaaaa-1111.json"),
      JSON.stringify({ creationDate: 1, requests: [turn("first chat")] }),
      "utf-8",
    );
    await writeFile(
      join(sessionsDir, "bbbbbbbb-2222.json"),
      JSON.stringify({ creationDate: 2, requests: [turn("second chat")] }),
      "utf-8",
    );

    const scraper = new CopilotScraper(workspaceStorageDir, stateDir);
    const chunks: CopilotChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);

    const ids = new Set(chunks.map((chunk) => chunk.sessionId));
    expect(ids.size).toBe(2);
    expect(ids.has("unknown")).toBe(false);
    expect([...ids].sort()).toEqual(["aaaaaaaa-1111", "bbbbbbbb-2222"]);
  });
});
