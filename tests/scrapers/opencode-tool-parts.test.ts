/**
 * An assistant turn that only ran tools left nothing behind. The reader kept
 * `text` parts and dropped everything else, so a message made of reads, edits
 * and commands produced no chunk at all and the session read as if the agent
 * had said nothing for the whole of the work.
 *
 * A tool part now leaves one line — the tool and what it was pointed at. The
 * call's output is not indexed (a read's output is the file), and reasoning
 * stays out, since that is the model's internal thought rather than anything it
 * did or said.
 */
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";
import type { OpenCodeChunk } from "@xtctx/types/scraper";

const T0 = 1_772_000_000_000;

let dir = "";
let dbPath = "";

function seed(parts: Array<Record<string, unknown>>, messageData: Record<string, unknown> = {}): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("ses", "/work/proj", "t", T0, T0);
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg",
    "ses",
    T0,
    T0,
    JSON.stringify({ role: "assistant", time: { created: T0 }, ...messageData }),
  );
  parts.forEach((part, index) => {
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
      `prt-${index}`,
      "msg",
      "ses",
      T0 + index,
      T0 + index,
      JSON.stringify(part),
    );
  });
  db.close();
}

async function collect(): Promise<OpenCodeChunk[]> {
  const chunks: OpenCodeChunk[] = [];
  for await (const chunk of new OpenCodeScraper(dbPath, dir).fullSync()) chunks.push(chunk);
  return chunks;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xtctx-oc-tools-"));
  dbPath = join(dir, "opencode.db");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("opencode tool parts", () => {
  it("leaves a 'tool' line per call for a turn that only ran tools", async () => {
    seed([
      { type: "reasoning", text: "I should look at the file first" },
      {
        type: "tool",
        tool: "read",
        callID: "c1",
        state: {
          status: "completed",
          title: "src/a.ts",
          input: { filePath: "/work/proj/src/a.ts" },
          output: "SECRET FILE CONTENTS",
        },
      },
      {
        type: "tool",
        tool: "bash",
        callID: "c2",
        state: { status: "completed", input: { command: "npm test" }, output: "ok" },
      },
    ]);

    const chunks = await collect();

    expect(chunks.map((chunk) => [chunk.role, chunk.content])).toEqual([
      ["tool", "used read: src/a.ts\nused bash: npm test"],
    ]);
    expect(JSON.stringify(chunks)).not.toContain("SECRET FILE CONTENTS");
    expect(JSON.stringify(chunks)).not.toContain("look at the file first");
  });

  it("keeps a message's text as it was and puts the calls after it", async () => {
    seed([
      { type: "tool", tool: "edit", state: { status: "completed", title: "src/b.ts" } },
      { type: "text", text: "I fixed it." },
    ]);

    const chunks = await collect();

    expect(chunks.map((chunk) => [chunk.role, chunk.content])).toEqual([
      ["assistant", "I fixed it."],
      ["tool", "used edit: src/b.ts"],
    ]);
    expect(chunks[1]!.timestamp.getTime()).toBeGreaterThan(chunks[0]!.timestamp.getTime());
    expect(chunks[1]!.metadata.messageIndex).toBe(chunks[0]!.metadata.messageIndex);
  });

  it("names a call with no usable target by its tool alone", async () => {
    seed([{ type: "tool", tool: "todowrite", state: { status: "pending" } }, { type: "tool" }]);

    expect((await collect()).map((chunk) => chunk.content)).toEqual(["used todowrite\nused tool"]);
  });
});
