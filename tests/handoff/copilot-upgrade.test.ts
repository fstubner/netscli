/**
 * Upgrading re-reads every VS Code chat file once.
 *
 * The scraper skips a chat file whose mtime is at or before the `since` it is
 * given, on the reasoning that VS Code has not written it since. After an
 * upgrade that reasoning is wrong: the file is unchanged but the scraper now
 * reads it differently, so a skipped file would keep its old, wrong rows.
 * A stored scraper version below the current one makes the scan ignore `since`
 * once, and the version is saved only when that read ran to the end.
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COPILOT_SCRAPER_VERSION, CopilotScraper } from "@xtctx/scrapers/copilot";

describe("copilot (VS Code) re-read on upgrade", () => {
  let root = "";
  let storage = "";
  let state = "";
  // After the chat file's mtime, so an unchanged file is always "already read".
  let since = new Date(0);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xtctx-copilot-upgrade-"));
    storage = join(root, "workspaceStorage");
    state = join(root, "state");
    await mkdir(join(storage, "hash", "chatSessions"), { recursive: true });
    await mkdir(state, { recursive: true });
    const db = new Database(join(storage, "hash", "state.vscdb"));
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.close();
    await writeFile(
      join(storage, "hash", "chatSessions", "s.json"),
      JSON.stringify({
        sessionId: "s",
        creationDate: 1,
        requests: [{ message: { parts: [{ text: "q" }] }, response: [{ value: "a" }] }],
      }),
    );
    since = new Date(Date.now() + 60_000);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function scrapeContents(): Promise<string[]> {
    const out: string[] = [];
    for await (const chunk of new CopilotScraper(storage, state).scrape(since)) {
      out.push(chunk.content);
    }
    return out;
  }

  async function storedVersion(): Promise<number | undefined> {
    try {
      const saved = JSON.parse(await readFile(join(state, "copilot-state.json"), "utf-8")) as {
        scraperVersion?: number;
      };
      return saved.scraperVersion;
    } catch {
      return undefined;
    }
  }

  it("reads an unchanged file once when the stored version is older, then skips it again", async () => {
    // No stored version: written by a scraper that predates the field.
    expect(await scrapeContents()).toEqual(["q", "a"]);
    expect(await storedVersion()).toBe(COPILOT_SCRAPER_VERSION);

    // The version now matches, so the mtime skip applies as before.
    expect(await scrapeContents()).toEqual([]);
  });

  it("re-reads when the stored version is below the current one", async () => {
    await writeFile(join(state, "copilot-state.json"), JSON.stringify({ lastTimestamp: new Date(0), scraperVersion: COPILOT_SCRAPER_VERSION - 1 }));

    expect(await scrapeContents()).toEqual(["q", "a"]);
  });

  it("does not mark the upgrade done when the read was cut short", async () => {
    for await (const chunk of new CopilotScraper(storage, state).scrape(since)) {
      void chunk;
      break;
    }

    expect(await storedVersion()).toBeUndefined();
    // So the next scan still reads the file.
    expect(await scrapeContents()).toEqual(["q", "a"]);
  });
});
