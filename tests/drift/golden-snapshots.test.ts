/**
 * Golden snapshot tests for each scraper.
 *
 * A known-good fixture is constructed deterministically, the scraper runs,
 * and the normalized output is compared against the committed snapshot JSON.
 *
 * To regenerate (deliberately) after a legitimate scraper change:
 *   XTCTX_UPDATE_SNAPSHOTS=1 npm run test:drift
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AntigravityScraper } from "@xtctx/scrapers/antigravity";
import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";
import { CodexCliScraper } from "@xtctx/scrapers/codex";
import { CopilotScraper } from "@xtctx/scrapers/copilot";
import { CopilotCliScraper } from "@xtctx/scrapers/copilot-cli";
import { CursorScraper } from "@xtctx/scrapers/cursor";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";
import type { ConversationChunk, ConversationScraper } from "@xtctx/types/scraper";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(__dirname, "snapshots");

function normalise(chunks: ConversationChunk[]): unknown {
  return chunks
    .map((chunk) => {
      const content = normalizeContent(chunk);
      return {
        tool: chunk.tool,
        sessionId: chunk.sessionId,
        role: chunk.role,
        content,
        timestamp: chunk.timestamp.toISOString(),
        messageIndex: chunk.metadata.messageIndex,
        tokenEstimate: Math.ceil(content.length / 4),
      };
    })
    .sort((a, b) => {
      if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
      if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
      return a.messageIndex - b.messageIndex;
    });
}

function normalizeContent(chunk: ConversationChunk): string {
  if (chunk.tool === "antigravity") {
    return chunk.content.replace(/^Source: .*$/m, "Source: <source>");
  }
  return chunk.content;
}

async function collectChunks(scraper: ConversationScraper): Promise<ConversationChunk[]> {
  const chunks: ConversationChunk[] = [];
  for await (const chunk of scraper.fullSync()) {
    chunks.push(chunk);
  }
  return chunks;
}

async function assertSnapshot(tool: string, normalized: unknown): Promise<void> {
  const snapshotPath = join(SNAPSHOT_DIR, `${tool}.json`);
  const update = process.env.XTCTX_UPDATE_SNAPSHOTS === "1" || !existsSync(snapshotPath);

  if (update) {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
    return;
  }

  const committed = JSON.parse(await readFile(snapshotPath, "utf-8")) as unknown;
  expect(normalized).toEqual(committed);
}

const tempDirs: string[] = [];

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function mkTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Golden snapshots", () => {
  it("claude-code", async () => {
    const tempDir = await mkTemp("xtctx-snap-claude-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    const project = join(tempDir, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "session-snap.jsonl"),
      [
        JSON.stringify({
          type: "human",
          content: "snapshot question one",
          timestamp: "2026-02-24T10:00:00Z",
        }),
        JSON.stringify({
          type: "assistant",
          content: "snapshot answer one",
          timestamp: "2026-02-24T10:00:05Z",
        }),
        // The real shape: a tool call, and its result written back as a
        // "user" record. The snapshot pins the result as role "tool"; a
        // regression to message.role would turn it into a user turn.
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } }],
          },
          timestamp: "2026-02-24T10:00:30Z",
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tu1", content: "all tests passed" }],
          },
          timestamp: "2026-02-24T10:00:40Z",
        }),
        JSON.stringify({
          type: "human",
          content: "snapshot question two",
          timestamp: "2026-02-24T10:01:00Z",
        }),
      ].join("\n") + "\n",
    );

    const scraper = new ClaudeCodeScraper(tempDir, stateDir);
    const chunks = await collectChunks(scraper);
    // Role shape, independent of the snapshot file (which a blanket
    // XTCTX_UPDATE_SNAPSHOTS=1 would rewrite): tool output must never read as
    // a user turn.
    expect(chunks.filter((c) => c.role === "user").map((c) => c.content)).toEqual([
      "snapshot question one",
      "snapshot question two",
    ]);
    expect(chunks.filter((c) => c.role === "tool").map((c) => c.content)).toEqual([
      "ran Bash: npm test",
      "all tests passed",
    ]);
    await assertSnapshot("claude-code", normalise(chunks));
  });

  it("codex", async () => {
    const tempDir = await mkTemp("xtctx-snap-codex-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    await writeFile(
      join(tempDir, "session-snap.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-02-24T09:59:00Z",
          type: "session_meta",
          payload: { id: "snap-codex-uuid" },
        }),
        JSON.stringify({
          timestamp: "2026-02-24T09:59:01Z",
          type: "turn_context",
          payload: {
            approval_policy: "suggest",
            sandbox_policy: { type: "workspace-write" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-24T10:00:00Z",
          type: "event_msg",
          payload: { type: "user_message", message: "snap q" },
        }),
        JSON.stringify({
          timestamp: "2026-02-24T10:00:05Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "snap a" }],
          },
        }),
      ].join("\n") + "\n",
    );

    const scraper = new CodexCliScraper(tempDir, stateDir);
    const chunks = await collectChunks(scraper);
    await assertSnapshot("codex", normalise(chunks));
  });

  it("copilot", async () => {
    const tempDir = await mkTemp("xtctx-snap-copilot-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    const wsStorage = join(tempDir, "workspaceStorage");
    await mkdir(join(wsStorage, "hash-snap"), { recursive: true });
    const db = new Database(join(wsStorage, "hash-snap", "state.vscdb"));
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
      "interactive.sessions",
      JSON.stringify({
        "0": {
          sessionId: "snap-copilot-session",
          creationDate: new Date("2026-02-24T10:00:00Z").getTime(),
          requests: [
            {
              message: { parts: [{ text: "q1" }] },
              response: [{ value: "a1" }],
              isCanceled: false,
              model: "gpt-4o-copilot",
            },
            {
              message: { parts: [{ text: "q2" }] },
              response: [{ value: "a2" }],
              isCanceled: false,
              model: "gpt-4o-copilot",
            },
          ],
        },
      }),
    );
    db.close();

    const scraper = new CopilotScraper(wsStorage, stateDir);
    const chunks = await collectChunks(scraper);
    await assertSnapshot("copilot", normalise(chunks));
  });

  it("cursor", async () => {
    const rootDir = await mkTemp("xtctx-snap-cursor-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    const workspaceDir = join(rootDir, "workspaceStorage", "hash-snap");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(join(rootDir, "globalStorage"), { recursive: true });

    const wsDb = new Database(join(workspaceDir, "state.vscdb"));
    wsDb.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    wsDb.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify({ allComposers: [{ composerId: "snap-composer" }] }),
    );
    wsDb.close();

    const composer = {
      composerId: "snap-composer",
      fullConversationHeadersOnly: [
        { bubbleId: "sb1", type: 1 },
        { bubbleId: "sb2", type: 2 },
      ],
      createdAt: new Date("2026-02-24T10:00:00Z").getTime(),
      modelConfig: { modelName: "gpt-4.1" },
      unifiedMode: "agent",
    };
    const globalDb = new Database(join(rootDir, "globalStorage", "state.vscdb"));
    globalDb.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const ins = globalDb.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    ins.run(`composerData:snap-composer`, JSON.stringify(composer));
    ins.run(
      `bubbleId:snap-composer:sb1`,
      JSON.stringify({ type: 1, text: "cursor snap q", createdAt: "2026-02-24T10:00:00Z" }),
    );
    ins.run(
      `bubbleId:snap-composer:sb2`,
      JSON.stringify({ type: 2, text: "cursor snap a", createdAt: "2026-02-24T10:00:05Z" }),
    );
    globalDb.close();

    const scraper = new CursorScraper(workspaceDir, stateDir);
    const chunks = await collectChunks(scraper);
    await assertSnapshot("cursor", normalise(chunks));
  });

  it("opencode", async () => {
    const rootDir = await mkTemp("xtctx-snap-opencode-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    const dbPath = join(rootDir, "opencode.db");

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT,
        parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL,
        path TEXT, title TEXT NOT NULL, version TEXT NOT NULL, share_url TEXT,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        time_compacting INTEGER, time_archived INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    const sessId = "snap-opencode-session";
    const t0 = new Date("2026-02-24T10:00:00Z").getTime();
    const t1 = new Date("2026-02-24T10:00:05Z").getTime();
    db.prepare(
      `INSERT INTO session VALUES (?, 'p1', NULL, NULL, 's', '/tmp', NULL, 'snap', '0.1', NULL, ?, ?, NULL, NULL)`,
    ).run(sessId, t0, t1);
    db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?)`).run(
      "m1",
      sessId,
      t0,
      t0,
      JSON.stringify({ id: "m1", sessionID: sessId, role: "user", agent: "build", time: { created: t0 } }),
    );
    db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?)`).run(
      "m2",
      sessId,
      t1,
      t1,
      JSON.stringify({
        id: "m2",
        sessionID: sessId,
        role: "assistant",
        agent: "build",
        modelID: "claude-3-5-sonnet",
        providerID: "anthropic",
        time: { created: t1 },
      }),
    );
    db.prepare(`INSERT INTO part VALUES (?, ?, ?, ?, ?)`).run(
      "p1",
      "m1",
      sessId,
      t0,
      JSON.stringify({ type: "text", text: "opencode snap q" }),
    );
    db.prepare(`INSERT INTO part VALUES (?, ?, ?, ?, ?)`).run(
      "p2",
      "m2",
      sessId,
      t1,
      JSON.stringify({ type: "text", text: "opencode snap a" }),
    );
    db.close();

    const scraper = new OpenCodeScraper(dbPath, stateDir);
    const chunks = await collectChunks(scraper);
    await assertSnapshot("opencode", normalise(chunks));
  });

  it("copilot-cli", async () => {
    const tempDir = await mkTemp("xtctx-snap-copilot-cli-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    const sessionDir = join(tempDir, "snap-copilot-cli-session");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "events.jsonl"),
      [
        JSON.stringify({
          type: "message",
          role: "user",
          content: "copilot cli snap q",
          timestamp: "2026-02-24T10:00:00Z",
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: "copilot cli snap a",
          timestamp: "2026-02-24T10:00:05Z",
        }),
      ].join("\n") + "\n",
    );

    const scraper = new CopilotCliScraper(tempDir, stateDir);
    const chunks = await collectChunks(scraper);
    await assertSnapshot("copilot-cli", normalise(chunks));
  });

  it("antigravity", async () => {
    const tempDir = await mkTemp("xtctx-snap-antigravity-");
    const stateDir = await mkTemp("xtctx-snap-state-");
    const sessionDir = join(tempDir, "brain", "snap-antigravity-session");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "task.md"),
      [
        "# Task",
        "",
        "Inspect [README.md](file:///h%3A/projects/private/needs-work/xtctx/README.md).",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      join(sessionDir, "task.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_TASK",
        summary: "Snap task summary.",
        updatedAt: "2026-02-24T10:00:00Z",
        version: "1",
      }),
      "utf-8",
    );

    const scraper = new AntigravityScraper(
      tempDir,
      stateDir,
      join("H:", "projects", "private", "needs-work", "xtctx"),
      { async listConversations() { return { conversations: [] }; } },
    );
    const chunks = await collectChunks(scraper);
    await assertSnapshot("antigravity", normalise(chunks));
  });
});
