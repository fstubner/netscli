/**
 * A `.jsonl` chat session is a journal, and a kind-2 record with an index `i`
 * means "cut the array back to length `i`, then push `v`" — not "insert at `i`".
 *
 * Applied as an insert, a record that rewrote the tail request left the old
 * copy beside the new one: a real session showed its first question twice and
 * hung answers on the wrong requests. The old reader then sorted requests by
 * timestamp, which hid how out of order they had become.
 */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopilotScraper } from "@xtctx/scrapers/copilot";
import type { CopilotChunk } from "@xtctx/types/scraper";

const request = (text: string, timestamp: number, answer?: string, extra: object = {}) => ({
  message: { parts: [{ text }] },
  response: answer === undefined ? [] : [{ value: answer }],
  isCanceled: false,
  timestamp,
  ...extra,
});

/**
 * Three requests, with every later update aimed at the last one. A fixture
 * file rather than inline records so that the drift suite can check it against
 * the committed journal fingerprint: a fixture that invents a field passes
 * here while proving something about a format VS Code does not write.
 */
const THREE_REQUEST_JOURNAL = readFileSync(
  fileURLToPath(new URL("./fixtures/copilot-chat-journal.jsonl", import.meta.url)),
  "utf-8",
).trim();

describe("copilot journal replay: a splice with an index truncates, then pushes", () => {
  let workspaceStorageDir = "";
  let stateDir = "";
  let sessionsDir = "";
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  async function collect(journal: string): Promise<CopilotChunk[]> {
    await writeFile(join(sessionsDir, "s.jsonl"), journal + "\n", "utf-8");
    const chunks: CopilotChunk[] = [];
    for await (const chunk of new CopilotScraper(workspaceStorageDir, stateDir).fullSync()) {
      chunks.push(chunk);
    }
    return chunks;
  }

  beforeEach(async () => {
    workspaceStorageDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-replay-"));
    stateDir = await mkdtemp(join(tmpdir(), "xtctx-copilot-replay-state-"));
    // A workspace needs a database for its directory to be discovered at all.
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

  it("yields exactly three user turns, each answered by its own request", async () => {
    const chunks = await collect(THREE_REQUEST_JOURNAL);

    expect(chunks.map((c) => [c.role, c.content])).toEqual([
      ["user", "first question"],
      ["assistant", "first answer"],
      ["user", "second question"],
      ["assistant", "second answer"],
      ["user", "third question"],
      ["assistant", "third answer"],
    ]);
    // The rewritten tail request replaced the old one rather than joining it.
    expect(chunks.filter((c) => c.metadata.model === "gpt-final")).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it("applies the truncate at response level too, so a rewritten answer is not doubled", async () => {
    const journal = [
      { kind: 0, v: { sessionId: "stream", creationDate: 1, requests: [] } },
      { kind: 2, k: ["requests"], v: [request("question", 1000)] },
      { kind: 2, k: ["requests", 0, "response"], v: [{ value: "partial " }] },
      { kind: 2, k: ["requests", 0, "response"], i: 0, v: [{ value: "whole answer" }] },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");

    expect((await collect(journal)).map((c) => c.content)).toEqual(["question", "whole answer"]);
  });

  it("treats a record with an index but no values as a bare truncate", async () => {
    const journal = [
      { kind: 0, v: { sessionId: "cut", creationDate: 1, requests: [] } },
      { kind: 2, k: ["requests"], v: [request("kept", 1000, "kept answer")] },
      { kind: 2, k: ["requests"], v: [request("dropped", 2000, "dropped answer")] },
      { kind: 2, k: ["requests"], i: 1 },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");

    expect((await collect(journal)).map((c) => c.content)).toEqual(["kept", "kept answer"]);
  });

  it("warns, rather than padding the array, when the index is past the end", async () => {
    const journal = [
      { kind: 0, v: { sessionId: "far", creationDate: 1, requests: [] } },
      { kind: 2, k: ["requests"], i: 5, v: [request("only", 1000, "answer")] },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");

    expect((await collect(journal)).map((c) => c.content)).toEqual(["only", "answer"]);
    expect(warnings.join("\n")).toContain("truncates at index 5");
  });

  it("reports a record kind it does not know instead of skipping it silently", async () => {
    const journal = [
      { kind: 0, v: { sessionId: "odd", creationDate: 1, requests: [] } },
      { kind: 7, k: ["requests"], v: [] },
      { kind: 2, k: ["requests"], v: [request("still read", 1000)] },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");

    expect((await collect(journal)).map((c) => c.content)).toEqual(["still read"]);
    expect(warnings.join("\n")).toContain("unknown record kind 7");
  });
});
