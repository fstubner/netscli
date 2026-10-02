/**
 * What the Copilot CLI scraper makes of subagent output, the CLI's own system
 * prompt, and tool executions.
 *
 * Events carrying `data.parentToolCallId` come from a subagent the main
 * assistant launched; indexed as ordinary assistant turns they read as the main
 * assistant speaking. `system.message` is the CLI's own prompt, not a turn. And
 * a tool execution, which has no text of its own, used to vanish.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopilotCliScraper } from "@xtctx/scrapers/copilot-cli";
import type { CopilotCliChunk } from "@xtctx/types/scraper";

const OURS = "H:/projects/ours";

const start = (cwd: string) => ({
  type: "session.start",
  timestamp: "2026-02-24T09:59:00Z",
  data: { context: { cwd, gitRoot: cwd } },
});

describe("copilot-cli subagent output, system prompt and tool executions", () => {
  let rootDir = "";
  let stateDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "xtctx-cc-sub-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-cc-sub-state-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  async function scrape(events: object[], projectRoot?: string): Promise<CopilotCliChunk[]> {
    const dir = join(rootDir, "sess");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "events.jsonl"),
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    );
    const chunks: CopilotCliChunk[] = [];
    for await (const chunk of new CopilotCliScraper(rootDir, stateDir, projectRoot).fullSync()) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it("files subagent output as tool output, marked as a subagent's", async () => {
    const chunks = await scrape([
      { type: "user.message", timestamp: "2026-02-24T10:00:00Z", data: { content: "review it" } },
      {
        type: "assistant.message",
        timestamp: "2026-02-24T10:00:05Z",
        data: { content: "subagent finding", parentToolCallId: "call-7" },
      },
      { type: "assistant.message", timestamp: "2026-02-24T10:00:09Z", data: { content: "my answer" } },
    ]);

    expect(chunks.map((c) => [c.role, c.content])).toEqual([
      ["user", "review it"],
      ["tool", "subagent finding"],
      ["assistant", "my answer"],
    ]);
    expect(chunks[1].metadata).toMatchObject({ subagent: true, parentToolCallId: "call-7" });
    // The main assistant's own turn carries neither marker.
    expect(chunks[2].metadata.subagent).toBeUndefined();
    expect(chunks[2].metadata.parentToolCallId).toBeUndefined();
  });

  it("skips the CLI's system prompt without calling it drift", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const chunks = await scrape([
        { type: "system.message", timestamp: "2026-02-24T09:59:30Z", data: { role: "system", content: "you are copilot" } },
        { type: "user.message", timestamp: "2026-02-24T10:00:00Z", data: { content: "hi" } },
      ]);

      expect(chunks.map((c) => c.content)).toEqual(["hi"]);
      expect(warnings).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("emits one short line per tool execution, naming the tool and its target", async () => {
    const chunks = await scrape([
      { type: "user.message", timestamp: "2026-02-24T10:00:00Z", data: { content: "run the tests" } },
      {
        type: "tool.execution_start",
        timestamp: "2026-02-24T10:00:01Z",
        data: { toolCallId: "c1", toolName: "bash", arguments: { command: "npm test", description: "Run tests" } },
      },
      {
        type: "tool.execution_start",
        timestamp: "2026-02-24T10:00:02Z",
        data: { toolCallId: "c2", toolName: "view", arguments: { path: "H:/projects/ours/a.ts", view_range: [1, 20] } },
      },
      {
        type: "tool.execution_start",
        timestamp: "2026-02-24T10:00:03Z",
        data: {
          toolCallId: "c3",
          toolName: "edit",
          arguments: { path: "H:/projects/ours/b.ts", old_str: "SECRET OLD", new_str: "SECRET NEW" },
        },
      },
      {
        type: "tool.execution_start",
        timestamp: "2026-02-24T10:00:04Z",
        data: { toolCallId: "c4", toolName: "bash", arguments: { command: "x".repeat(500) }, parentToolCallId: "call-7" },
      },
      // The completion carries the tool's output; it is not recorded.
      {
        type: "tool.execution_complete",
        timestamp: "2026-02-24T10:00:05Z",
        data: { toolCallId: "c1", success: true, result: { content: "all green" } },
      },
    ]);

    const tools = chunks.filter((c) => c.role === "tool");
    expect(tools.map((c) => c.content.slice(0, 40))).toEqual([
      "ran bash: npm test",
      "ran view: H:/projects/ours/a.ts",
      "ran edit: H:/projects/ours/b.ts",
      `ran bash: ${"x".repeat(30)}`,
    ]);
    // An edit's old and new text are file contents, not a summary.
    expect(chunks.some((c) => c.content.includes("SECRET"))).toBe(false);
    expect(tools[3].content.length).toBeLessThanOrEqual(200);
    expect(tools[3].metadata).toMatchObject({ subagent: true, parentToolCallId: "call-7" });
    expect(tools[0].metadata.subagent).toBeUndefined();
  });

  it("applies project scoping to tool lines like any other record", async () => {
    const tool = {
      type: "tool.execution_start",
      timestamp: "2026-02-24T10:00:01Z",
      data: { toolCallId: "c1", toolName: "bash", arguments: { command: "ls" } },
    };

    expect((await scrape([start("H:/projects/ours"), tool], OURS)).map((c) => c.content)).toEqual([
      "ran bash: ls",
    ]);
    await rm(join(rootDir, "sess"), { recursive: true, force: true });
    expect(await scrape([start("H:/projects/other"), tool], OURS)).toEqual([]);
  });
});
