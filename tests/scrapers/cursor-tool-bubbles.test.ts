/**
 * An agent's tool calls are bubbles with no text, and the reader kept only
 * bubbles with text. Every edit, command and search an agent made vanished: on
 * a real store 2,200 bubbles produced 278 chunks, so a session that spent most
 * of its time editing files read as a few sentences of chat.
 *
 * Each call now leaves one line saying what it did. The call's arguments are
 * not indexed — an edit's carry the file's whole new content — and thinking
 * bubbles stay out, which is the other half of what these tests pin.
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CursorScraper } from "@xtctx/scrapers/cursor";
import type { CursorChunk } from "@xtctx/types/scraper";

const COMPOSER_ID = "comp-tools-0001";

let rootDir = "";
let workspaceDir = "";
let stateDir = "";

type Bubble = Record<string, unknown>;

function seed(bubbles: Bubble[]): void {
  const ws = new Database(join(workspaceDir, "state.vscdb"));
  ws.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  ws.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "composer.composerData",
    JSON.stringify({ allComposers: [{ composerId: COMPOSER_ID }] }),
  );
  ws.close();

  const db = new Database(join(rootDir, "globalStorage", "state.vscdb"));
  db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT)");
  const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
  insert.run(
    `composerData:${COMPOSER_ID}`,
    JSON.stringify({
      composerId: COMPOSER_ID,
      fullConversationHeadersOnly: bubbles.map((_, index) => ({ bubbleId: `b${index}`, type: 2 })),
      unifiedMode: "agent",
    }),
  );
  bubbles.forEach((bubble, index) => {
    insert.run(
      `bubbleId:${COMPOSER_ID}:b${index}`,
      JSON.stringify({
        createdAt: new Date(Date.UTC(2026, 1, 24, 10, 0, index)).toISOString(),
        ...bubble,
      }),
    );
  });
  db.close();
}

async function collect(): Promise<CursorChunk[]> {
  const scraper = new CursorScraper(workspaceDir, stateDir);
  const chunks: CursorChunk[] = [];
  for await (const chunk of scraper.fullSync()) chunks.push(chunk);
  return chunks;
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-tools-"));
  stateDir = await mkdtemp(join(tmpdir(), "xtctx-cursor-tools-state-"));
  workspaceDir = join(rootDir, "workspaceStorage", "abc123");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(rootDir, "globalStorage"), { recursive: true });
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});

describe("CursorScraper tool-call bubbles", () => {
  it("leaves one 'tool' line per call, in turn order, without the call's arguments", async () => {
    seed([
      { type: 1, text: "fix the parser" },
      {
        type: 2,
        text: "",
        toolFormerData: {
          name: "edit_file_v2",
          params: JSON.stringify({
            relativeWorkspacePath: "src/parser.ts",
            streamingContent: "SECRET NEW FILE BODY",
          }),
          status: "completed",
        },
      },
      {
        type: 2,
        text: "",
        toolFormerData: {
          name: "run_terminal_command_v2",
          params: JSON.stringify({ command: "npm test\nsecond line is not indexed" }),
        },
      },
      { type: 2, text: "all green" },
    ]);

    const chunks = await collect();

    expect(chunks.map((chunk) => [chunk.role, chunk.content])).toEqual([
      ["user", "fix the parser"],
      ["tool", "used edit_file_v2: src/parser.ts"],
      ["tool", "used run_terminal_command_v2: npm test"],
      ["assistant", "all green"],
    ]);
    expect(chunks.map((chunk) => chunk.metadata.messageIndex)).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(chunks)).not.toContain("SECRET NEW FILE BODY");
  });

  it("falls back to rawArgs, then to the bare tool name", async () => {
    seed([
      {
        type: 2,
        text: "",
        toolFormerData: { name: "read_file_v2", params: "not json", rawArgs: '{"targetFile":"README.md"}' },
      },
      { type: 2, text: "", toolFormerData: { name: "todo_write" } },
    ]);

    expect((await collect()).map((chunk) => chunk.content)).toEqual([
      "used read_file_v2: README.md",
      "used todo_write",
    ]);
  });

  it("keeps thinking bubbles out", async () => {
    seed([
      { type: 1, text: "why is it slow" },
      { type: 2, text: "", thinking: { text: "the user wants a profile first" } },
      { type: 2, text: "profile it first" },
    ]);

    const chunks = await collect();

    expect(chunks.map((chunk) => chunk.content)).toEqual(["why is it slow", "profile it first"]);
    expect(JSON.stringify(chunks)).not.toContain("wants a profile");
  });

  it("prefers a bubble's own text over its tool call", async () => {
    seed([
      {
        type: 2,
        text: "I'll edit the file now",
        toolFormerData: { name: "edit_file_v2", params: JSON.stringify({ relativeWorkspacePath: "a.ts" }) },
      },
    ]);

    const chunks = await collect();

    expect(chunks.map((chunk) => [chunk.role, chunk.content])).toEqual([
      ["assistant", "I'll edit the file now"],
    ]);
  });
});
