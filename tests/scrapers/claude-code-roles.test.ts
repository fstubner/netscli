/**
 * Who said it: a Claude Code record's `message.role` is the API role, and
 * Claude Code writes every tool result back as a "user" record. Trusting the
 * field indexed 11,434 "user" messages against 5,325 "assistant" ones in a
 * real index, topped by "File created successfully" — so a handoff reading
 * "what did the user ask" got tool output.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";
import type { ClaudeCodeChunk } from "@xtctx/types/scraper";

describe("claude-code roles", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xtctx-roles-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-roles-state-"));
    await mkdir(join(tempDir, "proj"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(stateDir, { recursive: true, force: true });
  });

  async function scrape(records: unknown[]): Promise<ClaudeCodeChunk[]> {
    await writeFile(
      join(tempDir, "proj", "session-roles.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    const chunks: ClaudeCodeChunk[] = [];
    for await (const chunk of new ClaudeCodeScraper(tempDir, stateDir).fullSync()) {
      chunks.push(chunk);
    }
    return chunks;
  }

  const ts = (n: number) => `2026-02-24T10:00:${String(n).padStart(2, "0")}Z`;

  it("indexes tool results as tool, tool calls as short lines, and real prompts as user", async () => {
    const chunks = await scrape([
      { type: "user", message: { role: "user", content: "please fix the build" }, timestamp: ts(0) },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running the build." },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run build\nsecond line" } },
          ],
        },
        timestamp: ts(1),
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "build failed: boom" }],
        },
        timestamp: ts(2),
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "Edit",
              input: { file_path: "src/a.ts", old_string: "x".repeat(5000), new_string: "y" },
            },
          ],
        },
        timestamp: ts(3),
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t2", content: "The file src/a.ts has been updated" }],
        },
        timestamp: ts(4),
      },
      {
        // Real text next to a result: the text is what the person said.
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t2", content: "tool noise" },
            { type: "text", text: "now run the tests" },
          ],
        },
        timestamp: ts(5),
      },
    ]);

    expect(chunks.map((c) => [c.metadata.messageIndex, c.role, c.content])).toEqual([
      [0, "user", "please fix the build"],
      [1, "assistant", "Running the build.\nran Bash: npm run build"],
      [2, "tool", "build failed: boom"],
      [3, "tool", "edit src/a.ts"],
      [4, "tool", "The file src/a.ts has been updated"],
      [5, "user", "now run the tests"],
    ]);
  });

  it("strips terminal escape sequences from content", async () => {
    const esc = String.fromCharCode(27);
    const chunks = await scrape([
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: `${esc}[31mFAIL${esc}[0m src/a.test.ts` }],
        },
        timestamp: ts(0),
      },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe("FAIL src/a.test.ts");
  });
});
