/**
 * Which project a Cursor conversation belongs to is recorded in globalStorage's
 * `composerHeaders` table, not in the workspace.
 *
 * Current Cursor migrated the per-workspace conversation lists away
 * (`hasMigratedComposerData: true`, no `allComposers`), so a workspace says
 * nothing about its conversations any more. Everything was then attributed by
 * guessing from file paths recorded inside the conversation, and 3 of 100 real
 * conversations were filed under a second project because they had touched its
 * files. The header is the authority; the guess is for what it cannot place.
 *
 * Every database here is built by the test. None of this reads a real store.
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorScraper } from "@xtctx/scrapers/cursor";
import type { CursorChunk } from "@xtctx/types/scraper";

const PROJECT_A = join("H:", "projects", "private", "headers-alpha");
const PROJECT_B = join("H:", "projects", "private", "headers-beta");

let rootDir = "";
let stateDir = "";
let globalDbPath = "";

function folderUri(root: string): string {
  return `file:///${root.split(sep).join("/")}`;
}

/** A workspace directory as current Cursor writes it: no conversation list. */
async function addWorkspace(id: string, folder: string | undefined): Promise<void> {
  const dir = join(rootDir, "workspaceStorage", id);
  await mkdir(dir, { recursive: true });
  const db = new Database(join(dir, "state.vscdb"));
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "composer.composerData",
    JSON.stringify({ hasMigratedComposerData: true, selectedComposerIds: [] }),
  );
  db.close();
  if (folder !== undefined) {
    await writeFile(join(dir, "workspace.json"), JSON.stringify({ folder }), "utf-8");
  }
}

function openGlobal(): Database.Database {
  return new Database(globalDbPath);
}

interface ComposerSeed {
  /** The file the conversation recorded touching — what a path guess reads. */
  file?: string;
  text?: string;
  /** An assistant turn after the first, for conversations with two. */
  reply?: string;
  /** Omit for a conversation with no header row at all. */
  header?: { workspaceId: string | null; isSubagent?: number; subagentTypeName?: string };
}

function addComposer(composerId: string, seed: ComposerSeed): void {
  const db = openGlobal();
  const bubbleId = `${composerId}-bubble`;
  const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
  insert.run(
    `composerData:${composerId}`,
    JSON.stringify({
      composerId,
      fullConversationHeadersOnly: [
        { bubbleId, type: 1 },
        ...(seed.reply ? [{ bubbleId: `${bubbleId}-reply`, type: 2 }] : []),
      ],
      createdAt: new Date("2026-02-24T10:00:00Z").getTime(),
      context: { fileSelections: seed.file ? [{ fsPath: seed.file }] : [] },
    }),
  );
  insert.run(
    `bubbleId:${composerId}:${bubbleId}`,
    JSON.stringify({ type: 1, text: seed.text ?? composerId, createdAt: "2026-02-24T10:00:00Z" }),
  );
  if (seed.reply) {
    insert.run(
      `bubbleId:${composerId}:${bubbleId}-reply`,
      JSON.stringify({ type: 2, text: seed.reply, createdAt: "2026-02-24T10:00:05Z" }),
    );
  }
  if (seed.header) {
    db.prepare(
      "INSERT INTO composerHeaders (composerId, workspaceId, isSubagent, subagentTypeName) VALUES (?, ?, ?, ?)",
    ).run(
      composerId,
      seed.header.workspaceId,
      seed.header.isSubagent ?? 0,
      seed.header.subagentTypeName ?? null,
    );
  }
  db.close();
}

async function collectChunks(projectRoot: string): Promise<CursorChunk[]> {
  const scraper = new CursorScraper(join(rootDir, "workspaceStorage"), stateDir, projectRoot);
  const chunks: CursorChunk[] = [];
  for await (const chunk of scraper.fullSync()) chunks.push(chunk);
  return chunks;
}

async function collect(projectRoot: string): Promise<string[]> {
  return (await collectChunks(projectRoot)).map((chunk) => chunk.content).sort();
}

describe("CursorScraper attributes conversations by composerHeaders", () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-headers-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-headers-state-"));
    await mkdir(join(rootDir, "globalStorage"), { recursive: true });
    globalDbPath = join(rootDir, "globalStorage", "state.vscdb");
    const db = openGlobal();
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec(
      "CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, isSubagent INTEGER, subagentTypeName TEXT)",
    );
    db.close();

    await addWorkspace("ws-alpha", folderUri(PROJECT_A));
    await addWorkspace("ws-beta", folderUri(PROJECT_B));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  /**
   * The misfiling itself. The conversation was held in alpha's workspace but
   * read a file in beta, so a path guess handed it to beta's index — and
   * missed it for alpha, because nothing in it names alpha.
   */
  it("files a conversation under the workspace its header names, not the files it touched", async () => {
    addComposer("held-in-alpha", {
      text: "alpha's conversation",
      file: join(PROJECT_B, "src", "shared.ts"),
      header: { workspaceId: "ws-alpha" },
    });

    expect(await collect(PROJECT_A)).toEqual(["alpha's conversation"]);
    expect(await collect(PROJECT_B)).toEqual([]);
  });

  /** A header that places a conversation in a project needs no recorded file at all. */
  it("finds a conversation whose header names this workspace although it recorded no file", async () => {
    addComposer("no-files", { text: "no files recorded", header: { workspaceId: "ws-alpha" } });

    expect(await collect(PROJECT_A)).toEqual(["no files recorded"]);
  });

  /** No header row: nothing says where it belongs, so the recorded path still decides. */
  it("falls back to the recorded path for a conversation with no header row", async () => {
    addComposer("headerless-mine", {
      text: "headerless and ours",
      file: join(PROJECT_A, "src", "a.ts"),
    });
    addComposer("headerless-theirs", {
      text: "headerless and theirs",
      file: join(PROJECT_B, "src", "b.ts"),
    });

    expect(await collect(PROJECT_A)).toEqual(["headerless and ours"]);
  });

  /**
   * A header naming a workspace this machine no longer has, or one with no
   * folder (a multi-root workspace), does not say the conversation is another
   * project's. Throwing those away would lose conversations the path guess
   * used to find.
   */
  it.each([
    ["a workspace directory that is gone", "ws-pruned"],
    ["a workspace with no folder", "ws-multiroot"],
    ["no workspace id at all", null],
  ])("falls back to the recorded path when the header names %s", async (_label, workspaceId) => {
    await addWorkspace("ws-multiroot", undefined);
    addComposer("unresolved", {
      text: "placed by its file",
      file: join(PROJECT_A, "src", "a.ts"),
      header: { workspaceId },
    });

    expect(await collect(PROJECT_A)).toEqual(["placed by its file"]);
  });

  /** A workspace id is joined into a path, so one that is not a bare name is not followed. */
  it("does not follow a workspace id that is a path", async () => {
    addComposer("traversal", {
      text: "should not resolve",
      header: { workspaceId: join("..", "workspaceStorage", "ws-alpha") },
    });

    expect(await collect(PROJECT_A)).toEqual([]);
  });

  /**
   * An older Cursor has no such table. It is reported, because a renamed table
   * would look identical and attribution would quietly be back to guessing —
   * but the guess still works.
   */
  describe("when the table is missing", () => {
    let warnings: string[] = [];
    let originalWarn: typeof console.warn;

    beforeEach(() => {
      const db = openGlobal();
      db.exec("DROP TABLE composerHeaders");
      db.close();
      warnings = [];
      originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    });

    afterEach(() => {
      console.warn = originalWarn;
    });

    it("warns about the drift and still attributes by recorded path", async () => {
      addComposer("older-cursor", { text: "old format", file: join(PROJECT_A, "src", "a.ts") });

      expect(await collect(PROJECT_A)).toEqual(["old format"]);
      expect(warnings.join("\n")).toContain("composerHeaders");
    });
  });

  /**
   * The unlisted-conversation search ran a `value LIKE` over the whole of
   * globalStorage on every scan: 9 to 28 seconds on a 6.9GB store. With the
   * header table the candidates are known by id, so that query has no reason to
   * run. Its absence is checked on the statements themselves, because the
   * results are the same either way — that is exactly why it went unnoticed.
   */
  it("does not scan every stored conversation's value when the table is there", async () => {
    addComposer("held-in-alpha", { text: "listed by header", header: { workspaceId: "ws-alpha" } });
    addComposer("headerless-mine", {
      text: "headerless and ours",
      file: join(PROJECT_A, "src", "a.ts"),
    });

    const statements: string[] = [];
    const prepare = Database.prototype.prepare;
    vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
      this: Database.Database,
      source: string,
    ) {
      statements.push(source);
      return prepare.call(this, source);
    } as typeof Database.prototype.prepare);

    expect(await collect(PROJECT_A)).toEqual(["headerless and ours", "listed by header"]);
    expect(statements.some((statement) => /value\s+LIKE/i.test(statement))).toBe(false);
  });
});

/**
 * A subagent's conversation is stored like any other, and its first "user"
 * turn is the prompt the parent agent wrote for it. Indexed as a standalone
 * session with that turn as the user's, it presented the parent agent's
 * instructions as something the person had said.
 */
describe("CursorScraper subagent conversations", () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-subagent-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-subagent-state-"));
    await mkdir(join(rootDir, "globalStorage"), { recursive: true });
    globalDbPath = join(rootDir, "globalStorage", "state.vscdb");
    const db = openGlobal();
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec(
      "CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, isSubagent INTEGER, subagentTypeName TEXT)",
    );
    db.close();
    await addWorkspace("ws-alpha", folderUri(PROJECT_A));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  it("marks the conversation and gives the parent's prompt the role 'tool'", async () => {
    addComposer("child", {
      text: "explore the repo and report back",
      reply: "found three modules",
      header: { workspaceId: "ws-alpha", isSubagent: 1, subagentTypeName: "explore" },
    });

    const chunks = await collectChunks(PROJECT_A);

    expect(chunks.map((chunk) => [chunk.role, chunk.content])).toEqual([
      ["tool", "explore the repo and report back"],
      ["assistant", "found three modules"],
    ]);
    for (const chunk of chunks) {
      expect(chunk.metadata.subagent).toBe(true);
      expect(chunk.metadata.subagentType).toBe("explore");
    }
  });

  it("leaves an ordinary conversation's first turn as the user's and unmarked", async () => {
    addComposer("parent", {
      text: "please refactor this",
      reply: "done",
      header: { workspaceId: "ws-alpha" },
    });

    const chunks = await collectChunks(PROJECT_A);

    expect(chunks.map((chunk) => chunk.role)).toEqual(["user", "assistant"]);
    expect(chunks[0]?.metadata.subagent).toBeUndefined();
    expect(chunks[0]?.metadata.subagentType).toBeUndefined();
  });

  it("recognises a subagent by its type name when the flag is not set", async () => {
    addComposer("typed-only", {
      text: "a prompt from a parent",
      header: { workspaceId: "ws-alpha", isSubagent: 0, subagentTypeName: "generalPurpose" },
    });

    const [chunk] = await collectChunks(PROJECT_A);

    expect(chunk?.role).toBe("tool");
    expect(chunk?.metadata.subagentType).toBe("generalPurpose");
  });
});
