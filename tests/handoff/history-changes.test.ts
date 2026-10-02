/**
 * Changes to history the index already holds have to reach it.
 *
 * Two ways they did not, both in a single process with nothing concurrent:
 *
 * - A transcript rewritten in place kept its old text in the index. The resume
 *   check refused the cursor and re-read the file from the top, but every
 *   record was then filtered against the scraper's saved `lastTimestamp` — a
 *   rewritten early turn is stamped long before it, so it was dropped, and
 *   the stale row was never replaced. A rewrite past the first kilobyte was
 *   not even noticed: the head hash covered only that kilobyte, so the read
 *   resumed at the old byte offset in the middle of different content.
 *
 * - A message appended with a timestamp earlier than the saved `lastTimestamp`
 *   was skipped by the same filter while the file's byte cursor moved past
 *   it, so no later scan read it again. The per-file byte offset already says
 *   what is new in an append-only file; the global timestamp second-guessed it.
 */
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";
import { CodexCliScraper } from "@xtctx/scrapers/codex";
import type { ConversationScraper } from "@xtctx/types/scraper";

const at = (n: number): string =>
  new Date(Date.parse("2026-05-10T10:00:00.000Z") + n * 60_000).toISOString();

/** Long enough that a turn past the first one sits beyond the first kilobyte. */
const PADDING = " lorem ipsum dolor sit amet".repeat(20);

describe("claude-code history that changes after it was indexed", () => {
  let root = "";
  let projectsDir = "";
  let storeDir = "";
  let stateDir = "";
  let transcript = "";

  const record = (n: number, content: string, stamp = at(n)): string =>
    JSON.stringify({
      type: n % 2 === 0 ? "user" : "assistant",
      timestamp: stamp,
      cwd: root,
      message: { role: n % 2 === 0 ? "user" : "assistant", content },
    }) + "\n";

  async function scan(): Promise<string[]> {
    const scraper = new ClaudeCodeScraper(projectsDir, stateDir, root, storeDir);
    return scanAndRead(scraper, join(stateDir, "xtctx.db"), root, "claude-code:s");
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "xtctx-history-")));
    projectsDir = join(root, "projects");
    storeDir = join(projectsDir, "store");
    stateDir = join(root, "state");
    transcript = join(storeDir, "s.jsonl");
    await mkdir(storeDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const turns = (texts: string[]): string =>
    texts.map((text, n) => record(n, text)).join("");

  it("replaces a turn rewritten at the head of the file", async () => {
    const original = ["first draft", `reply${PADDING}`, `more${PADDING}`, "last"];
    await writeFile(transcript, turns(original), "utf-8");
    expect(await scan()).toEqual(original);

    const rewritten = ["first draft, corrected", ...original.slice(1)];
    await writeFile(transcript, turns(rewritten), "utf-8");

    expect(await scan()).toEqual(rewritten);
  });

  it("replaces a turn rewritten past the first kilobyte", async () => {
    const original = [`opening${PADDING}`, `reply${PADDING}`, "the third turn", `more${PADDING}`, "last"];
    await writeFile(transcript, turns(original), "utf-8");
    expect(await scan()).toEqual(original);
    expect((await readFile(transcript, "utf-8")).indexOf("the third turn")).toBeGreaterThan(1024);

    // Longer than before, so the file does not shrink and the head is intact:
    // the two signals the old check had both say "append".
    const rewritten = [...original];
    rewritten[2] = "the third turn, rewritten with rather more to say than before";
    await writeFile(transcript, turns(rewritten), "utf-8");

    expect(await scan()).toEqual(rewritten);
  });

  it("keeps an appended message stamped before the last scan's newest", async () => {
    await writeFile(transcript, turns(["one", "two", "three"]), "utf-8");
    expect(await scan()).toEqual(["one", "two", "three"]);

    // Clocks disagree, a tool replays a turn, a session is resumed from an
    // older one: an appended record is not guaranteed to be the newest.
    await appendFile(transcript, record(3, "late but real", at(0)), "utf-8");

    expect((await scan()).sort()).toEqual(["late but real", "one", "three", "two"]);
  });
});

describe("codex history that changes after it was indexed", () => {
  let root = "";
  let sessionsDir = "";
  let stateDir = "";
  let file = "";

  const meta = (): string =>
    JSON.stringify({ timestamp: at(0), type: "session_meta", payload: { id: "c1", cwd: root } }) + "\n";
  const message = (text: string, stamp: string): string =>
    JSON.stringify({
      timestamp: stamp,
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    }) + "\n";

  async function scan(): Promise<string[]> {
    const scraper = new CodexCliScraper(sessionsDir, stateDir, root);
    return scanAndRead(scraper, join(stateDir, "xtctx.db"), root, "codex:c1");
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "xtctx-history-codex-")));
    sessionsDir = join(root, "sessions");
    stateDir = join(root, "state");
    file = join(sessionsDir, "rollout-c1.jsonl");
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("keeps an appended message stamped before the last scan's newest", async () => {
    await writeFile(file, meta() + message("one", at(1)) + message("two", at(2)), "utf-8");
    expect(await scan()).toEqual(["one", "two"]);

    await appendFile(file, message("late but real", at(1)), "utf-8");

    expect((await scan()).sort()).toEqual(["late but real", "one", "two"]);
  });

  it("replaces a message rewritten in place", async () => {
    await writeFile(file, meta() + message("one", at(1)) + message("two", at(2)), "utf-8");
    expect(await scan()).toEqual(["one", "two"]);

    await writeFile(file, meta() + message("one, amended", at(1)) + message("two", at(2)), "utf-8");

    expect(await scan()).toEqual(["one, amended", "two"]);
  });
});

/** One scan in a fresh index over the same files, then the session's text in order. */
async function scanAndRead(
  scraper: ConversationScraper,
  dbPath: string,
  root: string,
  sessionRef: string,
): Promise<string[]> {
  const index = new SqliteHandoffIndex(dbPath, root, [{ tool: scraper.tool, scraper }], {
    refreshBudgetMs: 0,
  });
  try {
    await index.listRecentSessions(5);
    await index.whenScanSettled();
    return (await index.getSessionDetail(sessionRef, 0, 50)).map((m) => m.content);
  } finally {
    await index.close();
  }
}
