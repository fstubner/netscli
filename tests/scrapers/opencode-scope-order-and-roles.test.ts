/**
 * Four opencode behaviours that a mutation sweep found nothing defending.
 *
 * The existing suite builds its fixture database with `directory TEXT NOT
 * NULL`, so the case the fail-closed filter exists for — a session row with a
 * null `directory` — could not occur in any test. Admitting those rows serves
 * conversations that nothing has attributed to this project, and they are
 * stamped with this project's root on the way into the index, so the index's
 * own filter cannot catch them afterwards.
 *
 * A message's own recorded time beats the row's. They are usually the same;
 * when they are not, reading only the row can place a message *before* the
 * incremental cutoff that has already passed, and it is then never emitted
 * again — a permanent loss with no signal.
 *
 * A message below the cutoff still consumes a message index, or the same turn
 * gets one index on a full sync and another on an incremental one. Chunk ids
 * hash the index, so that re-emits it under a second id rather than
 * deduplicating against what is stored.
 *
 * And a message whose `role` field has gone must be skipped, not defaulted.
 * `normalizeRole` maps anything unrecognised to "system", so emitting the
 * record anyway silently relabels every turn in the store as system context on
 * the day the field is renamed.
 */
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";
import type { OpenCodeChunk } from "@xtctx/types/scraper";

const OURS = "H:/projects/ours";

interface MessageSeed {
  id: string;
  /** Written verbatim into `message.data`, so a role can be omitted entirely. */
  data: Record<string, unknown>;
  time_created: number;
  text: string;
}

/**
 * A database with `directory` nullable, which is what opencode's own schema
 * allows and what the existing fixture builder cannot express.
 */
function buildDb(
  dbPath: string,
  sessions: { id: string; directory: string | null; messages: MessageSeed[] }[],
): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT,
      title TEXT,
      time_created INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  const insertSession = db.prepare(
    "INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)",
  );
  const insertMessage = db.prepare(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
  );
  const insertPart = db.prepare(
    "INSERT INTO part (id, message_id, time_created, data) VALUES (?, ?, ?, ?)",
  );

  for (const session of sessions) {
    insertSession.run(session.id, session.directory, "t", 1_772_000_000_000);
    for (const message of session.messages) {
      insertMessage.run(message.id, session.id, message.time_created, JSON.stringify(message.data));
      insertPart.run(
        `${message.id}-p`,
        message.id,
        message.time_created,
        JSON.stringify({ type: "text", text: message.text }),
      );
    }
  }
  db.close();
}

describe("opencode session scoping fails closed on an unattributable session", () => {
  let dir = "";
  let dbPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-oc-scope-"));
    dbPath = join(dir, "opencode.db");
    buildDb(dbPath, [
      {
        id: "sess-null",
        directory: null,
        messages: [
          {
            id: "m1",
            data: { role: "assistant" },
            time_created: 1_772_000_100_000,
            text: "UNATTRIBUTED: could be anyone's",
          },
        ],
      },
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function scrape(projectRoot?: string): Promise<string[]> {
    const out: OpenCodeChunk[] = [];
    const scraper = new OpenCodeScraper(dbPath, dir, projectRoot);
    for await (const chunk of scraper.fullSync()) out.push(chunk);
    return out.map((c) => c.content);
  }

  it("does not serve a session whose directory is null", async () => {
    expect(await scrape(OURS)).toEqual([]);
  });

  it("still serves it when there is no project to scope to", async () => {
    // Unscoped use has no boundary to fail closed on, so the filter must not
    // become an unconditional refusal.
    expect(await scrape()).toEqual(["UNATTRIBUTED: could be anyone's"]);
  });
});

describe("opencode reads a message's own recorded time", () => {
  let dir = "";
  let dbPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-oc-time-"));
    dbPath = join(dir, "opencode.db");
    buildDb(dbPath, [
      {
        id: "sess-1",
        directory: OURS,
        messages: [
          {
            id: "m1",
            // The row was written when the turn was created; the payload
            // carries when it actually happened. Reading only the row places
            // this message behind a cutoff that has already gone past, and it
            // is never emitted again.
            data: { role: "assistant", time: { created: 1_772_000_900_000 } },
            time_created: 1_772_000_100_000,
            text: "later than the row says",
          },
        ],
      },
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits a message the row's time would have hidden behind the cutoff", async () => {
    const out: OpenCodeChunk[] = [];
    const scraper = new OpenCodeScraper(dbPath, dir, OURS);
    for await (const chunk of scraper.scrape(new Date(1_772_000_500_000))) out.push(chunk);

    expect(out.map((c) => c.content)).toEqual(["later than the row says"]);
    expect(out[0]?.timestamp.getTime()).toBe(1_772_000_900_000);
  });
});

describe("opencode message index is the same on a full and an incremental read", () => {
  let dir = "";
  let dbPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-oc-index-"));
    dbPath = join(dir, "opencode.db");
    buildDb(dbPath, [
      {
        id: "sess-1",
        directory: OURS,
        messages: [
          { id: "m1", data: { role: "user" }, time_created: 1_772_000_100_000, text: "first" },
          { id: "m2", data: { role: "assistant" }, time_created: 1_772_000_900_000, text: "second" },
        ],
      },
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gives a message the same index whether or not the ones before it were emitted", async () => {
    const full: OpenCodeChunk[] = [];
    for await (const chunk of new OpenCodeScraper(dbPath, dir, OURS).fullSync()) full.push(chunk);
    const secondOnFullSync = full.find((c) => c.content === "second");

    const partial: OpenCodeChunk[] = [];
    for await (const chunk of new OpenCodeScraper(dbPath, dir, OURS).scrape(
      new Date(1_772_000_500_000),
    )) {
      partial.push(chunk);
    }

    // The session has a message past the cutoff, so it is read from its first
    // message: the earlier one is emitted again, at the index it always had.
    expect(partial.map((c) => c.content)).toEqual(["first", "second"]);
    expect(secondOnFullSync?.metadata.messageIndex).toBe(1);
    expect(partial[1]?.metadata.messageIndex).toBe(secondOnFullSync?.metadata.messageIndex);
  });
});

describe("opencode skips a message whose role field has gone", () => {
  let dir = "";
  let dbPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-oc-role-"));
    dbPath = join(dir, "opencode.db");
    buildDb(dbPath, [
      {
        id: "sess-1",
        directory: OURS,
        messages: [
          {
            id: "m1",
            // No `role` key at all — what a rename looks like.
            data: { agent: "build" },
            time_created: 1_772_000_100_000,
            text: "whose turn is this?",
          },
          {
            id: "m2",
            data: { role: "assistant" },
            time_created: 1_772_000_200_000,
            text: "still readable",
          },
        ],
      },
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does not index it as system context, and says why", async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

    const out: OpenCodeChunk[] = [];
    try {
      for await (const chunk of new OpenCodeScraper(dbPath, dir, OURS).fullSync()) out.push(chunk);
    } finally {
      console.warn = original;
    }

    // Emitting it would relabel a real turn as system context — the default
    // `normalizeRole` returns for anything it cannot read.
    expect(out.map((c) => c.content)).toEqual(["still readable"]);
    expect(warnings.some((w) => w.includes("missing 'role' field"))).toBe(true);

    // The skipped record must not consume an index. `scan.ts` hashes the
    // index into the row id, so a skip that advances it renumbers every later
    // turn — the defect already fixed in the cursor reader, and the only skip
    // in this loop whose index nothing pinned.
    expect(out[0]?.metadata.messageIndex).toBe(0);
  });
});
