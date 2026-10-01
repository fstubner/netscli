import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSER_HEADER_COLUMNS } from "@xtctx/scrapers/cursor";

/**
 * Cursor's conversation-to-workspace map lives in globalStorage's
 * `composerHeaders` table, and attribution now depends on it: a rename of
 * `workspaceId` would not break anything loudly, it would quietly put every
 * conversation back on guessing from file paths. The format fingerprint is
 * where a change like that is recorded, so it has to name every column the
 * scraper reads.
 *
 * What this pins is the link between the two, not the real store — the
 * fingerprint's columns are what a capture from a machine with Cursor
 * installed has to agree with.
 */
describe("cursor format fingerprint covers composerHeaders", () => {
  it("lists every column the scraper reads", async () => {
    const fingerprint = JSON.parse(
      await readFile(join("tests", "drift", "fingerprints", "cursor.json"), "utf-8"),
    ) as { globalStorage?: { tables?: { composerHeaders?: string[] } } };

    const recorded = (fingerprint.globalStorage?.tables?.composerHeaders ?? []).map((entry) =>
      entry.slice(0, entry.indexOf(": ")),
    );

    expect(recorded.sort()).toEqual([...COMPOSER_HEADER_COLUMNS].sort());
  });
});
