/**
 * Export and import: the way to keep a copy of what only the index holds.
 *
 * Once a tool has cleaned up a transcript, the index is its only copy, so
 * deleting the index (or losing the disk) loses the session. An export taken
 * before that brings it back.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { ExportFormatError } from "@xtctx/handoff/export-file";
import { AgingStoreScraper } from "./aging-store.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xtctx-export-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function open(store: AgingStoreScraper, dbName = "xtctx.db"): SqliteHandoffIndex {
  return new SqliteHandoffIndex(join(dir, dbName), dir, [{ tool: store.tool, scraper: store }], {
    refreshBudgetMs: 60_000,
  });
}

async function exportLines(index: SqliteHandoffIndex): Promise<string[]> {
  const lines: string[] = [];
  await index.exportSessions((line) => {
    lines.push(line);
    return Promise.resolve();
  });
  return lines;
}

async function* feed(lines: string[]): AsyncIterable<string> {
  yield* lines;
}

/** An index holding one session still on disk and one whose transcript is gone. */
async function agedIndex(): Promise<{ store: AgingStoreScraper; lines: string[] }> {
  const store = new AgingStoreScraper(dir)
    .write("kept", ["the session still on disk", "its reply"])
    .write("aged", ["the only copy of the release checklist", "is in the index now"], {
      gitBranch: "release",
      at: "2026-04-01T09:00:00.000Z",
    });
  const index = open(store);
  await index.listRecentSessions(10);
  store.age("aged");
  const lines = await exportLines(index);
  await index.close();
  return { store, lines };
}

describe("xtctx export and import", () => {
  it("restores sessions whose transcripts are gone after the index is deleted", async () => {
    const { store, lines } = await agedIndex();

    expect(JSON.parse(lines[0] as string)).toMatchObject({ type: "xtctx-export", format_version: 1 });
    expect(JSON.parse(lines.at(-1) as string)).toEqual({ type: "end", sessions: 2, messages: 4 });

    // The index is lost; a rebuild finds only what is still on disk.
    await rm(join(dir, "xtctx.db"), { force: true });
    await rm(join(dir, "xtctx.db-wal"), { force: true });
    await rm(join(dir, "xtctx.db-shm"), { force: true });
    const index = open(store);
    expect((await index.listRecentSessions(10)).map((session) => session.session_ref)).toEqual([
      "codex:kept",
    ]);

    const summary = await index.importSessions(feed(lines));
    const refs = (await index.listRecentSessions(10)).map((session) => session.session_ref);
    const aged = await index.getSessionByRef("codex:aged");
    const detail = await index.getSessionDetail("codex:aged", 0, 10);
    const found = await index.searchSessions("release checklist", 5, undefined, "keyword");
    await index.close();

    expect(summary).toMatchObject({
      sessionsInFile: 2,
      sessionsAdded: 1,
      sessionsUnchanged: 1,
      messagesAdded: 2,
      invalidLines: [],
      complete: true,
    });
    expect(refs.sort()).toEqual(["codex:aged", "codex:kept"]);
    expect(aged).toMatchObject({ message_count: 2, git_branch: "release" });
    expect(detail.map((message) => message.content)).toEqual([
      "the only copy of the release checklist",
      "is in the index now",
    ]);
    expect(found.map((session) => session.session_ref)).toEqual(["codex:aged"]);
  });

  it("adds nothing when the same export is imported twice", async () => {
    const { store, lines } = await agedIndex();
    const index = open(store, "other.db");

    const first = await index.importSessions(feed(lines));
    const statusAfterFirst = await index.getStatus();
    const second = await index.importSessions(feed(lines));
    const statusAfterSecond = await index.getStatus();
    await index.close();

    expect(first).toMatchObject({ sessionsAdded: 2, messagesAdded: 4 });
    expect(second).toMatchObject({
      sessionsAdded: 0,
      sessionsUpdated: 0,
      sessionsUnchanged: 2,
      messagesAdded: 0,
    });
    for (const field of ["sessions", "messages", "retrieval_units"] as const) {
      expect(statusAfterSecond[field]).toBe(statusAfterFirst[field]);
    }
    expect(statusAfterSecond.messages).toBe(4);
  });

  it("imports what a file cut short holds, and says it was cut short", async () => {
    const { store, lines } = await agedIndex();
    const index = open(store, "other.db");

    // The end line is gone and the last session line is cut mid-way.
    const cut = [...lines.slice(0, -2), (lines.at(-2) as string).slice(0, 40)];
    const summary = await index.importSessions(feed(cut));
    await index.close();

    expect(summary.complete).toBe(false);
    expect(summary.sessionsAdded).toBe(1);
    expect(summary.invalidLines).toHaveLength(1);
  });

  it("refuses a file that is not an export, or is from a newer format, before writing anything", async () => {
    const index = open(new AgingStoreScraper(dir), "other.db");

    await expect(index.importSessions(feed(['{"hello":"world"}']))).rejects.toThrow(ExportFormatError);
    await expect(
      index.importSessions(
        feed([
          JSON.stringify({ type: "xtctx-export", format_version: 2 }),
          JSON.stringify({ type: "session", session_ref: "codex:x" }),
        ]),
      ),
    ).rejects.toThrow(/newer xtctx/);
    const status = await index.getStatus();
    await index.close();
    expect(status.sessions).toBe(0);
  });
});
