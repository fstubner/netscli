/**
 * What the Copilot scraper turns a request's response into.
 *
 * A response is a list of typed items. Joining the `.value` of every item
 * dropped inline file references (a real answer read "files at:\n- \n- "),
 * dropped tool invocations, and let the model's thinking in as if it were its
 * answer. Every turn also carried the session's creation date, and a cancelled
 * request lost its prompt along with its answer.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopilotScraper } from "@xtctx/scrapers/copilot";
import type { CopilotChunk } from "@xtctx/types/scraper";

describe("CopilotScraper response items", () => {
  let workspaceStorageDir = "";
  let stateDir = "";
  let sessionsDir = "";
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  const CREATED = new Date("2026-03-01T08:00:00Z").getTime();

  async function collect(requests: unknown[], creationDate: number = CREATED): Promise<CopilotChunk[]> {
    await writeFile(
      join(sessionsDir, "s.json"),
      JSON.stringify({ sessionId: "items", creationDate, requests }),
      "utf-8",
    );
    const chunks: CopilotChunk[] = [];
    for await (const chunk of new CopilotScraper(workspaceStorageDir, stateDir).fullSync()) {
      chunks.push(chunk);
    }
    return chunks;
  }

  const ask = (text: string, extra: object = {}) => ({
    message: { parts: [{ text }] },
    ...extra,
  });

  beforeEach(async () => {
    workspaceStorageDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-items-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-items-state-"));
    await mkdir(join(workspaceStorageDir, "hash"), { recursive: true });
    const db = new Database(join(workspaceStorageDir, "hash", "state.vscdb"));
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.close();
    sessionsDir = join(workspaceStorageDir, "hash", "chatSessions");
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

  describe("selected by kind", () => {
    const response = [
      { kind: "thinking", value: "private reasoning that is not the answer", id: "t1" },
      { value: "The files are at:\n- ", supportThemeIcons: false },
      {
        kind: "inlineReference",
        inlineReference: { $mid: 1, fsPath: "h:\\proj\\a.ts", path: "/h:/proj/a.ts", scheme: "file" },
      },
      { value: "\n- " },
      {
        kind: "inlineReference",
        inlineReference: { uri: { path: "/h:/proj/b%20c.ts", scheme: "file" }, range: {} },
      },
      { value: "\n" },
      {
        kind: "toolInvocationSerialized",
        toolId: "copilot_readFile",
        invocationMessage: { value: "Reading [](file:///h%3A/proj/a.ts)" },
        pastTenseMessage: { value: "Read [](file:///h%3A/proj/a.ts)" },
      },
      { kind: "undoStop", id: "u1" },
      { kind: "markdownContent", content: { value: "Done." } },
    ];

    it("renders file references as their path and keeps markdown", async () => {
      const chunks = await collect([ask("where are they", { response })]);

      expect(chunks.map((c) => [c.role, c.content])).toEqual([
        ["user", "where are they"],
        ["assistant", "The files are at:\n- h:\\proj\\a.ts\n- /h:/proj/b c.ts"],
        ["tool", "ran copilot_readFile: Read /h:/proj/a.ts"],
        ["assistant", "Done."],
      ]);
      expect(warnings).toEqual([]);
    });

    it("leaves thinking out of the answer", async () => {
      const chunks = await collect([ask("q", { response })]);

      expect(chunks.some((c) => c.content.includes("private reasoning"))).toBe(false);
    });

    it("falls back to the invocation wording and to the bare tool name", async () => {
      const chunks = await collect([
        ask("q", {
          response: [
            { kind: "toolInvocationSerialized", toolId: "run_in_terminal", invocationMessage: "Running `npm test`" },
            { kind: "toolInvocationSerialized", toolId: "mystery" },
          ],
        }),
      ]);

      expect(chunks.filter((c) => c.role === "tool").map((c) => c.content)).toEqual([
        "ran run_in_terminal: Running `npm test`",
        "ran mystery",
      ]);
    });

    it("keeps a tool line to one short line", async () => {
      const long = `Running ${"x".repeat(500)}\nsecond line`;
      const chunks = await collect([
        ask("q", { response: [{ kind: "toolInvocationSerialized", toolId: "t", invocationMessage: long }] }),
      ]);

      const line = chunks.find((c) => c.role === "tool")?.content ?? "";
      expect(line).not.toContain("\n");
      expect(line.length).toBeLessThanOrEqual(200);
    });

    it("reports an item kind it has no rendering for, but not the known non-text ones", async () => {
      await collect([
        ask("q", {
          response: [
            { kind: "undoStop", id: "u" },
            { kind: "somethingNew", value: "text under a name we have not seen" },
            { value: "answer" },
          ],
        }),
      ]);

      expect(warnings.join("\n")).toContain('unrecognised response item kind "somethingNew"');
      expect(warnings.join("\n")).not.toContain("undoStop");
    });
  });

  describe("per-request timestamps", () => {
    it("stamps each turn with its request's own time and falls back to the creation date", async () => {
      const t1 = new Date("2026-03-02T09:00:00Z").getTime();
      const t2 = new Date("2026-03-04T17:30:00Z").getTime();
      const chunks = await collect([
        ask("first", { response: [{ value: "one" }], timestamp: t1 }),
        ask("second", { response: [{ value: "two" }], timestamp: t2 }),
        ask("no stamp", { response: [{ value: "three" }] }),
      ]);

      expect(chunks.map((c) => c.timestamp.getTime())).toEqual([t1, t1, t2, t2, CREATED, CREATED]);
    });
  });

  describe("older and unfinished requests", () => {
    it("accepts a response that is one plain string (2023 format)", async () => {
      const chunks = await collect([ask("old question", { response: "old answer" })]);

      expect(chunks.map((c) => [c.role, c.content])).toEqual([
        ["user", "old question"],
        ["assistant", "old answer"],
      ]);
    });

    it("keeps the prompt of a cancelled request that has no answer", async () => {
      const chunks = await collect([ask("stopped early", { isCanceled: true, response: [] })]);

      expect(chunks.map((c) => [c.role, c.content])).toEqual([["user", "stopped early"]]);
    });
  });
});
