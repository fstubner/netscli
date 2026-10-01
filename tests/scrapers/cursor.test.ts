import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CursorScraper } from "@xtctx/scrapers/cursor";
import type { CursorChunk } from "@xtctx/types/scraper";

/**
 * Cursor's real storage is split across two SQLite databases:
 *
 *  <root>/workspaceStorage/<hash>/state.vscdb
 *    └─ ItemTable: { key: 'composer.composerData', value: JSON }
 *       JSON has allComposers[].composerId linking to the global DB.
 *
 *  <root>/globalStorage/state.vscdb
 *    └─ cursorDiskKV:
 *         composerData:<composerId>  → session metadata + bubble header list
 *         bubbleId:<composerId>:<bubbleId> → individual message content
 *
 * The scraper derives the global DB path by replacing "/workspaceStorage/..."
 * with "/globalStorage/state.vscdb" relative to the Cursor user directory.
 */

const COMPOSER_ID = "comp-test-1234";
const BUBBLE_USER_ID = "bubble-user-0001";
const BUBBLE_ASST_ID = "bubble-asst-0002";

function createWorkspaceDb(path: string, composerIds: string[]) {
  const db = new Database(path);
  db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const composerData = {
    allComposers: composerIds.map((id) => ({ composerId: id })),
  };
  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "composer.composerData",
    JSON.stringify(composerData),
  );
  db.close();
}

function createGlobalDb(path: string) {
  const db = new Database(path);
  db.exec(
    `CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );

  // Composer-level metadata with ordered bubble headers.
  const composerData = {
    composerId: COMPOSER_ID,
    fullConversationHeadersOnly: [
      { bubbleId: BUBBLE_USER_ID, type: 1 },
      { bubbleId: BUBBLE_ASST_ID, type: 2 },
    ],
    createdAt: new Date("2026-02-24T10:00:00Z").getTime(),
    lastUpdatedAt: new Date("2026-02-24T10:00:05Z").getTime(),
    modelConfig: { modelName: "gpt-4.1" },
    unifiedMode: "agent",
  };

  // Individual message bubbles.
  const userBubble = {
    type: 1,
    text: "cursor first",
    createdAt: "2026-02-24T10:00:00Z",
  };
  const asstBubble = {
    type: 2,
    text: "cursor second",
    createdAt: "2026-02-24T10:00:05Z",
    modelInfo: { modelName: "gpt-4.1" },
  };

  const insert = db.prepare(
    "INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)",
  );
  insert.run(`composerData:${COMPOSER_ID}`, JSON.stringify(composerData));
  insert.run(
    `bubbleId:${COMPOSER_ID}:${BUBBLE_USER_ID}`,
    JSON.stringify(userBubble),
  );
  insert.run(
    `bubbleId:${COMPOSER_ID}:${BUBBLE_ASST_ID}`,
    JSON.stringify(asstBubble),
  );
  db.close();
}

describe("CursorScraper", () => {
  let rootDir = "";
  let workspaceDir = "";
  let stateDir = "";
  let scraper: CursorScraper;

  beforeEach(async () => {
    // Replicate Cursor's directory layout so deriveGlobalStoragePath() works:
    //   rootDir/
    //     workspaceStorage/abc123/state.vscdb  ← workspace DB
    //     globalStorage/state.vscdb             ← global DB
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-state-"));

    workspaceDir = join(rootDir, "workspaceStorage", "abc123");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(join(rootDir, "globalStorage"), { recursive: true });

    createWorkspaceDb(join(workspaceDir, "state.vscdb"), [COMPOSER_ID]);
    createGlobalDb(join(rootDir, "globalStorage", "state.vscdb"));

    scraper = new CursorScraper(workspaceDir, stateDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("detects cursor workspace storage", async () => {
    expect(await scraper.detect()).toBe(true);
  });

  it("reads bubbles from global cursorDiskKV and maps metadata", async () => {
    const chunks: CursorChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);

    expect(chunks[0].role).toBe("user");
    expect(chunks[0].content).toBe("cursor first");
    expect(chunks[0].sessionId).toBe(COMPOSER_ID);

    // Model comes from composerData.modelConfig when bubble has no modelInfo.
    expect(chunks[0].metadata.model).toBe("gpt-4.1");

    // composerMode comes from composerData.unifiedMode.
    expect(chunks[0].metadata.composerMode).toBe("agent");

    expect(chunks[1].role).toBe("assistant");
    expect(chunks[1].content).toBe("cursor second");
    // Model on second bubble overrides from bubble.modelInfo.
    expect(chunks[1].metadata.model).toBe("gpt-4.1");
  });

  it("supports incremental scraping with since cutoff", async () => {
    const chunks: CursorChunk[] = [];
    for await (const chunk of scraper.scrape(new Date("2026-02-24T10:00:00Z"))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("cursor second");
  });

  /**
   * Detection answers "is Cursor installed", not "does it hold anything for
   * this project" — which is what every other scraper's detect() means, and
   * what `xtctx status` reports. Deciding it by opening each workspace to test
   * project membership cost 3.2s per call on a real machine, and `getStatus()`
   * runs detection for all seven scrapers on every call.
   */
  it("detects an installed Cursor even when no workspace matches this project", async () => {
    await writeFile(
      join(workspaceDir, "workspace.json"),
      JSON.stringify({ folder: "file:///somewhere/else/entirely" }),
      "utf-8",
    );

    const scoped = new CursorScraper(
      join(rootDir, "workspaceStorage"),
      stateDir,
      join("/not", "this", "project"),
    );

    expect(await scoped.detect()).toBe(true);

    // Installed, but nothing here belongs to this project.
    const chunks: CursorChunk[] = [];
    for await (const chunk of scoped.fullSync()) chunks.push(chunk);
    expect(chunks).toEqual([]);
  });

  it("limits project-scoped scrapers to matching Cursor workspace folders", async () => {
    await writeFile(
      join(workspaceDir, "workspace.json"),
      JSON.stringify({ folder: "file:///c%3A/some/project" }),
      "utf-8",
    );

    const otherWorkspaceDir = join(rootDir, "workspaceStorage", "other");
    await mkdir(otherWorkspaceDir, { recursive: true });
    createWorkspaceDb(join(otherWorkspaceDir, "state.vscdb"), [COMPOSER_ID]);
    await writeFile(
      join(otherWorkspaceDir, "workspace.json"),
      JSON.stringify({ folder: "file:///other/project" }),
      "utf-8",
    );

    const scoped = new CursorScraper(
      join(rootDir, "workspaceStorage"),
      stateDir,
      "c:\\some\\project",
    );
    const chunks: CursorChunk[] = [];
    for await (const chunk of scoped.fullSync()) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.content)).toEqual(["cursor first", "cursor second"]);
  });

  it("returns no chunks when workspace has no composer data", async () => {
    // Create a scraper pointing at a workspace with no composer.composerData key.
    const emptyWsDir = join(rootDir, "workspaceStorage", "empty");
    await mkdir(emptyWsDir, { recursive: true });
    const emptyDb = new Database(join(emptyWsDir, "state.vscdb"));
    emptyDb.exec(
      `CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    emptyDb.close();

    const emptyWsStateDir = await mkdtemp(join(tmpdir(), "xtctx-state2-"));
    const emptyScraper = new CursorScraper(emptyWsDir, emptyWsStateDir);
    const chunks: CursorChunk[] = [];
    for await (const chunk of emptyScraper.fullSync()) {
      chunks.push(chunk);
    }
    await rm(emptyWsStateDir, { recursive: true, force: true });

    expect(chunks).toHaveLength(0);
  });
});

/**
 * Cursor's workspaces list only the conversations they still care about, while
 * globalStorage keeps them all. On a real machine that was 165 referenced
 * against 593 stored, so discovering sessions through workspaces alone could
 * not reach most of the history that existed.
 *
 * These conversations have no workspace to inherit a project from, so they are
 * placed by the file paths recorded inside them — and only by those. Guessing
 * from a project's name appearing in prose is what once handed one project
 * another project's private transcripts.
 */
describe("CursorScraper reading conversations no workspace lists", () => {
  let rootDir = "";
  let stateDir = "";
  let globalDbPath = "";
  const projectRoot = join("H:", "projects", "private", "orphan-project");

  function addOrphan(
    composerId: string,
    pathValue: unknown,
    text = "orphaned turn",
    /**
     * A non-path field carrying the project's name. Present so the fixture
     * survives the coarse SQL filter and reaches the attribution check —
     * without it a negative test passes because the row was never examined,
     * which is a test that cannot fail.
     */
    title = "about orphan-project",
  ): void {
    const db = new Database(globalDbPath);
    const bubbleId = `${composerId}-bubble`;
    db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${composerId}`,
      JSON.stringify({
        composerId,
        name: title,
        fullConversationHeadersOnly: [{ bubbleId, type: 1 }],
        createdAt: new Date("2026-02-24T10:00:00Z").getTime(),
        // Where Cursor records the files a conversation touched.
        context: { fileSelections: pathValue === undefined ? [] : [{ fsPath: pathValue }] },
      }),
    );
    db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${composerId}:${bubbleId}`,
      JSON.stringify({ type: 1, text, createdAt: "2026-02-24T10:00:00Z" }),
    );
    db.close();
  }

  async function collect(): Promise<CursorChunk[]> {
    const scraper = new CursorScraper(join(rootDir, "workspaceStorage"), stateDir, projectRoot);
    const chunks: CursorChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    return chunks;
  }

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-orphan-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-orphan-state-"));

    // A workspace that belongs to the project, listing no composers of its own.
    const wsDir = join(rootDir, "workspaceStorage", "wshash");
    await mkdir(wsDir, { recursive: true });
    createWorkspaceDb(join(wsDir, "state.vscdb"), []);
    await writeFile(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: `file:///${projectRoot.split(sep).join("/")}` }),
      "utf-8",
    );

    await mkdir(join(rootDir, "globalStorage"), { recursive: true });
    globalDbPath = join(rootDir, "globalStorage", "state.vscdb");
    const db = new Database(globalDbPath);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.close();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("reads one whose recorded file is inside the project", async () => {
    addOrphan("orphan-mine", join(projectRoot, "src", "index.ts"), "a turn worth keeping");

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["a turn worth keeping"]);
  });

  /**
   * The dangerous case, and the reason attribution is by recorded path rather
   * than by text: a conversation in another project that merely *mentions*
   * this one. Its turn text carries the project name so it survives the coarse
   * SQL filter and only the path check can reject it — otherwise this test
   * would pass without any attribution logic at all.
   */
  it("leaves another project's conversation alone even when it names this one", async () => {
    addOrphan(
      "orphan-theirs",
      join("H:", "projects", "private", "someone-else", "src", "a.ts"),
      "we should copy how orphan-project did this",
    );

    expect(await collect()).toEqual([]);
  });

  /** No recorded location means no basis to attribute it — fail closed. */
  it("skips one that records no file at all", async () => {
    addOrphan("orphan-nowhere", undefined, "all about orphan-project, but no files");

    expect(await collect()).toEqual([]);
  });

  /**
   * Real globalStorage holds rows whose value is a literal `null`. It parses
   * cleanly and then throws on the first property access, which took down the
   * entire scan — every workspace-referenced conversation included.
   */
  /**
   * globalStorage holds rows whose value is not an object at all. A bare
   * string or number reaches the parse (it carries the project name, so the
   * coarse filter lets it through) and must not be mistaken for a
   * conversation. A literal `null` is guarded against too, though the coarse
   * filter means nothing on this machine can currently deliver one — that
   * guard is defence, not something these tests reach.
   */
  it.each([
    ["a bare string", JSON.stringify("orphan-project notes")],
    ["a number", JSON.stringify(42)],
  ])("survives a composer row holding %s", async (_label, value) => {
    const db = new Database(globalDbPath);
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      "composerData:orphan-broken",
      value,
    );
    db.close();
    addOrphan("orphan-mine", join(projectRoot, "src", "index.ts"), "still read");

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["still read"]);
  });

  /**
   * `COMPOSER_PATH_FIELDS` is an allowlist of the fields Cursor records a file
   * *location* under, and the walk deliberately checks nothing else. A foreign
   * conversation can still carry a path of ours somewhere — a command it ran, a
   * link it was given, an argument it echoed back — and none of those say the
   * conversation belongs here.
   *
   * Found by mutation: dropping the key check, so any string field counted,
   * left the whole suite green. Every existing fixture puts the project's path
   * in a path field and only the project's *name* elsewhere, so nothing
   * separated "recorded a file here" from "mentioned a path". Without the
   * allowlist this conversation — whose recorded files are all another
   * project's — is served as ours.
   */
  it("does not attribute one that names a path of ours outside a location field", async () => {
    const composerId = "orphan-mentioning";
    const bubbleId = `${composerId}-bubble`;
    const ourFile = join(projectRoot, "src", "index.ts");
    const db = new Database(globalDbPath);
    db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${composerId}`,
      JSON.stringify({
        composerId,
        name: "about orphan-project",
        fullConversationHeadersOnly: [{ bubbleId, type: 1 }],
        createdAt: new Date("2026-02-24T10:00:00Z").getTime(),
        // The files this conversation actually recorded are someone else's.
        context: {
          fileSelections: [{ fsPath: join("H:", "projects", "private", "someone-else", "a.ts") }],
        },
        // Ours, but not as a recorded location: an argument the conversation
        // happened to carry, and a link it was handed.
        toolCall: { argument: ourFile },
        reference: { url: `file:///${ourFile.split(sep).join("/")}` },
      }),
    );
    db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${composerId}:${bubbleId}`,
      JSON.stringify({ type: 1, text: "their turn", createdAt: "2026-02-24T10:00:00Z" }),
    );
    db.close();

    expect(await collect()).toEqual([]);
  });

  it("does not read them twice when a workspace already lists one", async () => {
    addOrphan("orphan-mine", join(projectRoot, "src", "index.ts"), "listed once");

    // The same conversation, now also referenced by the workspace.
    const ws = new Database(join(rootDir, "workspaceStorage", "wshash", "state.vscdb"));
    ws.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify({ allComposers: [{ composerId: "orphan-mine" }] }),
    );
    ws.close();

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["listed once"]);
  });
});

/**
 * The two ways this feature was inert in the wild. Both were invisible to the
 * tests it shipped with, because those always started from a fresh index and a
 * workspace that matched.
 */
describe("CursorScraper orphan discovery preconditions", () => {
  let rootDir = "";
  let stateDir = "";
  let globalDbPath = "";
  const projectRoot = join("H:", "projects", "private", "precondition-project");

  function addOrphan(composerId: string, ageDays: number): void {
    const db = new Database(globalDbPath);
    const bubbleId = `${composerId}-bubble`;
    const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${composerId}`,
      JSON.stringify({
        composerId,
        fullConversationHeadersOnly: [{ bubbleId, type: 1 }],
        context: { fileSelections: [{ fsPath: join(projectRoot, "src", "a.ts") }] },
      }),
    );
    db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${composerId}:${bubbleId}`,
      JSON.stringify({ type: 1, text: "older than any cursor", createdAt: when }),
    );
    db.close();
  }

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-pre-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-pre-state-"));
    await mkdir(join(rootDir, "globalStorage"), { recursive: true });
    globalDbPath = join(rootDir, "globalStorage", "state.vscdb");
    const db = new Database(globalDbPath);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.close();
    addOrphan("orphan-old", 10);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  async function collect(): Promise<CursorChunk[]> {
    const scraper = new CursorScraper(join(rootDir, "workspaceStorage"), stateDir, projectRoot);
    const chunks: CursorChunk[] = [];
    for await (const chunk of scraper.scrape()) chunks.push(chunk);
    return chunks;
  }

  /**
   * These conversations are older than the cursor by definition — no workspace
   * lists them any more. Filtering them by it meant the feature only ever
   * worked on a project that had never been indexed.
   */
  it("finds them even when the scrape cursor has moved past them", async () => {
    const wsDir = join(rootDir, "workspaceStorage", "wshash");
    await mkdir(wsDir, { recursive: true });
    createWorkspaceDb(join(wsDir, "state.vscdb"), []);
    await writeFile(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: `file:///${projectRoot.split(sep).join("/")}` }),
      "utf-8",
    );

    // A cursor two days old: the orphan's only turn is ten days old.
    await writeFile(
      join(stateDir, "cursor-state.json"),
      JSON.stringify({ lastTimestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }),
      "utf-8",
    );

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["older than any cursor"]);
  });

  /**
   * globalStorage sits at a fixed sibling of the store path. Locating it from
   * a workspace that matched the project meant a pruned workspaceStorage entry
   * — or a multi-root workspace, which records no `folder` — disabled this.
   */
  it("finds them when no workspace maps to the project at all", async () => {
    const wsDir = join(rootDir, "workspaceStorage", "elsewhere");
    await mkdir(wsDir, { recursive: true });
    createWorkspaceDb(join(wsDir, "state.vscdb"), []);
    await writeFile(
      join(wsDir, "workspace.json"),
      JSON.stringify({ folder: "file:///somewhere/else/entirely" }),
      "utf-8",
    );

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["older than any cursor"]);
  });

  it("finds them when workspaceStorage holds nothing at all", async () => {
    await mkdir(join(rootDir, "workspaceStorage"), { recursive: true });

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["older than any cursor"]);
  });
});

/**
 * The orphan pass opens globalStorage a second time. When that read failed it
 * escaped the scraper rather than being reported, and the index records an
 * escaped error as a scrape failure for the whole tool — losing every
 * workspace-referenced conversation as well, and leaving `last_error` set in
 * `status`. The workspace loop has always treated the same condition as drift
 * and carried on.
 */
describe("CursorScraper when globalStorage cannot be read for orphans", () => {
  let rootDir = "";
  let stateDir = "";
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;
  const projectRoot = join("H:", "projects", "private", "unreadable-project");

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-unreadable-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-unreadable-state-"));
    await mkdir(join(rootDir, "workspaceStorage"), { recursive: true });
    await mkdir(join(rootDir, "globalStorage"), { recursive: true });

    // A database that opens but has no cursorDiskKV table.
    const db = new Database(join(rootDir, "globalStorage", "state.vscdb"));
    db.exec("CREATE TABLE something_else (k TEXT)");
    db.close();

    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("reports it as drift rather than failing the scrape", async () => {
    const scraper = new CursorScraper(join(rootDir, "workspaceStorage"), stateDir, projectRoot);

    const chunks: CursorChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of scraper.fullSync()) chunks.push(chunk);
      })(),
    ).resolves.toBeUndefined();

    expect(chunks).toEqual([]);
    expect(warnings.join("\n")).toContain("globalStorage unreadable while looking for unlisted");
  });
});

/**
 * Two shapes that empty a workspace in silence.
 *
 * Both are guarded in the reader and neither was pinned: a mutation sweep
 * deleted each warning in turn and the whole suite stayed green. Cursor's
 * storage format is not ours, so the drift warning is the only way a rename
 * becomes visible before someone notices their history has gone missing — and
 * both of these fail by producing *no chunks*, which looks exactly like a
 * workspace that was never used.
 */
describe("CursorScraper reports workspace shapes it cannot read", () => {
  let rootDir = "";
  let stateDir = "";
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  async function collect(): Promise<CursorChunk[]> {
    const scraper = new CursorScraper(join(rootDir, "workspaceStorage"), stateDir);
    const chunks: CursorChunk[] = [];
    for await (const chunk of scraper.fullSync()) chunks.push(chunk);
    return chunks;
  }

  function writeWorkspaceValue(value: unknown): void {
    const db = new Database(join(rootDir, "workspaceStorage", "wshash", "state.vscdb"));
    db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify(value),
    );
    db.close();
  }

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-shape-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-shape-state-"));

    const wsDir = join(rootDir, "workspaceStorage", "wshash");
    await mkdir(wsDir, { recursive: true });
    createWorkspaceDb(join(wsDir, "state.vscdb"), []);

    await mkdir(join(rootDir, "globalStorage"), { recursive: true });
    const global = new Database(join(rootDir, "globalStorage", "state.vscdb"));
    global.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    // Present, as in current Cursor: its absence is reported as drift, which
    // would turn the "stays quiet" case below into a different test.
    global.exec("CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT)");
    global.close();

    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  /**
   * `allComposers` retyped — an object keyed by id rather than a list, say.
   * Every conversation in the workspace disappears, and without the warning
   * nothing distinguishes that from an empty workspace.
   */
  it("reports 'allComposers' arriving as something other than an array", async () => {
    writeWorkspaceValue({ allComposers: { "comp-1": { composerId: "comp-1" } } });

    expect(await collect()).toEqual([]);
    expect(warnings.join("\n")).toContain("allComposers");
  });

  /** An empty workspace is normal and must stay quiet, or the warning is noise. */
  it("stays quiet about a workspace that simply lists no composers", async () => {
    writeWorkspaceValue({ allComposers: [] });

    expect(await collect()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  /**
   * The workspace names a conversation globalStorage does not hold. That is how
   * a changed key prefix looks from here — the workspace half still reads, the
   * message bodies are simply never found — so it is reported rather than
   * skipped in silence.
   */
  it("reports a composer the workspace lists but globalStorage does not hold", async () => {
    writeWorkspaceValue({ allComposers: [{ composerId: "comp-vanished" }] });

    expect(await collect()).toEqual([]);
    expect(warnings.join("\n")).toContain("missing from globalStorage");
  });
});
