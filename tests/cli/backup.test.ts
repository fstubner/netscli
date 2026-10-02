/**
 * `xtctx export` and `xtctx import` as a person runs them.
 *
 * Home and app-data directories are redirected for the whole file, so nothing
 * here can read or write the real `~/.xtctx` or any real transcript store,
 * and every tool is switched off in the project's config.
 */
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExport, runImport } from "@xtctx/cli/backup";
import { setupProject } from "@xtctx/config/setup";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";
import { AgingStoreScraper } from "../handoff/aging-store.js";

const ENV_KEYS = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] as const;

describe("xtctx export / import", () => {
  let projectRoot = "";
  let homeDir = "";
  let saved: Record<string, string | undefined> = {};
  let out: string[] = [];
  let err: string[] = [];

  beforeEach(async () => {
    projectRoot = await realpath(await mkdtemp(join(tmpdir(), "xtctx-backup-")));
    homeDir = await mkdtemp(join(tmpdir(), "xtctx-backup-home-"));
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) {
      process.env[key] = homeDir;
    }
    await setupProject({ projectPath: projectRoot, homeDir, yes: true });
    await writeFile(
      join(projectRoot, ".xtctx", "config.yaml"),
      [
        "tools:",
        ...["claude-code", "cursor", "codex", "copilot", "antigravity", "opencode", "copilot-cli"].flatMap(
          (tool) => [`  ${tool}:`, "    enabled: false"],
        ),
        "",
      ].join("\n"),
      "utf-8",
    );
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    process.exitCode = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  const dbPath = (): string => join(projectRoot, ".xtctx", "state", "xtctx.db");

  /** Index a session, then let its transcript be cleaned up. */
  async function seedAgedSession(): Promise<void> {
    const store = new AgingStoreScraper(join(projectRoot, ".xtctx", "state")).write("aged", [
      "only the index remembers this deploy plan",
    ]);
    const index = new SqliteHandoffIndex(dbPath(), projectRoot, [{ tool: store.tool, scraper: store }], {
      refreshBudgetMs: 60_000,
    });
    await index.listRecentSessions(5);
    await index.close();
  }

  async function indexedRefs(): Promise<string[]> {
    const index = new SqliteHandoffIndex(dbPath(), projectRoot, []);
    const refs = (await index.listIndexedSessions(10)).map((session) => session.session_ref);
    await index.close();
    return refs;
  }

  it("round-trips a session through a deleted index", async () => {
    await seedAgedSession();
    const file = join(homeDir, "backup.jsonl");

    await runExport({ projectPath: projectRoot, out: file });
    expect(process.exitCode).toBeUndefined();
    expect(out.join("")).toContain("Exported 1 session (1 messages)");
    expect(await readFile(file, "utf-8")).toContain("only the index remembers this deploy plan");

    await rm(join(projectRoot, ".xtctx", "state"), { recursive: true, force: true });
    expect(await indexedRefs()).toEqual([]);

    await runImport({ projectPath: projectRoot, file });
    expect(process.exitCode).toBeUndefined();
    expect(out.join("")).toContain("1 session added");
    expect(await indexedRefs()).toEqual(["codex:aged"]);
  });

  it("never overwrites an existing file", async () => {
    await seedAgedSession();
    const file = join(homeDir, "backup.jsonl");
    await writeFile(file, "an older backup", "utf-8");

    await runExport({ projectPath: projectRoot, out: file });

    expect(process.exitCode).toBe(1);
    expect(err.join("")).toContain("never overwrites");
    expect(await readFile(file, "utf-8")).toBe("an older backup");
  });

  it("refuses a file that is not an export and exits nonzero", async () => {
    const file = join(homeDir, "notes.jsonl");
    await writeFile(file, '{"just":"some json"}\n', "utf-8");

    await runImport({ projectPath: projectRoot, file });

    expect(process.exitCode).toBe(1);
    expect(err.join("")).toContain("not an xtctx export");
  });
});
