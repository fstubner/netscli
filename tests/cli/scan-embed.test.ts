/**
 * `scan --embed` exists because nothing works the embedding backlog down
 * between commands, and searches only chip at it a few seconds per call —
 * measured on a live 9,232-window project, covering the corpus that way
 * needed on the order of 570 searches.
 *
 * The default matters more than the flag: without it, nothing calls the drain
 * at all. That is the assertion below.
 *
 * These tests also pin that `scan --embed` touches no model when
 * `XTCTX_DISABLE_EMBEDDINGS=1` is set. Auto-calibration was added to that path
 * and did not check the switch, so it spawned two or three child processes
 * that each loaded the real model — which timed both of these out at 60s on a
 * CI runner, and would have cost a user minutes on a command they had told
 * not to embed.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScan } from "@xtctx/cli/scan";
import { setupProject } from "@xtctx/config/setup";
import { SqliteHandoffIndex } from "@xtctx/handoff/sqlite-index";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("xtctx scan and the embedding backlog", () => {
  let projectRoot = "";
  let homeDir = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "xtctx-scan-embed-"));
    homeDir = await mkdtemp(join(tmpdir(), "xtctx-scan-embed-home-"));
    await setupProject({ projectPath: projectRoot, homeDir, yes: true });
    // Every reader switched off: this asserts what the command does about
    // embedding, and left on it would read every transcript store on the
    // machine.
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("does not touch the backlog without --embed", async () => {
    const drain = vi.spyOn(SqliteHandoffIndex.prototype, "embedBacklog");

    await runScan({ projectPath: projectRoot });

    expect(drain).not.toHaveBeenCalled();
  }, 60_000);

  it("does not calibrate when embeddings are switched off", async () => {
    // `XTCTX_DISABLE_EMBEDDINGS=1` means the model is never loaded. Auto
    // calibration loads it in a child process per device, so ignoring the
    // switch turned "scan without touching a model" into minutes of doing
    // exactly that — caught as a 60s timeout on a CI runner, where these two
    // tests had always passed before.
    // Home redirected at the empty temp dir, so the developer's own cached
    // verdict cannot make this pass for the wrong reason: with one present,
    // calibration is skipped regardless and the guard under test is never
    // reached. That is exactly why these tests passed here and failed on CI.
    const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    const written: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);

    try {
      await runScan({ projectPath: projectRoot, embed: true });
    } finally {
      write.mockRestore();
      process.env.HOME = realHome.HOME;
      process.env.USERPROFILE = realHome.USERPROFILE;
      // `--embed` with the switch on now says nothing was embedded and exits 1.
      process.exitCode = 0;
    }

    expect(written.join("")).not.toContain("Measuring this machine's embedding devices");
  });

  it("drains it with --embed when the local model is enabled", async () => {
    const drain = vi.spyOn(SqliteHandoffIndex.prototype, "embedBacklog");
    // Enabled, as far as the provider choice goes: a runtime directory with the
    // package in it, and the test suite's blanket switch-off lifted. Nothing is
    // loaded, because a project with no windows has nothing to embed.
    const runtime = await mkdtemp(join(tmpdir(), "xtctx-scan-embed-runtime-"));
    const manifest = join(runtime, "node_modules", "@huggingface", "transformers", "package.json");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, "{}", "utf-8");
    const saved = {
      dir: process.env.XTCTX_EMBEDDING_RUNTIME_DIR,
      disable: process.env.XTCTX_DISABLE_EMBEDDINGS,
    };
    process.env.XTCTX_EMBEDDING_RUNTIME_DIR = runtime;
    process.env.XTCTX_DISABLE_EMBEDDINGS = "0";

    try {
      await runScan({ projectPath: projectRoot, embed: true, calibrate: false });
    } finally {
      restoreEnv("XTCTX_EMBEDDING_RUNTIME_DIR", saved.dir);
      restoreEnv("XTCTX_DISABLE_EMBEDDINGS", saved.disable);
      await rm(runtime, { recursive: true, force: true });
    }

    expect(drain).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("says semantic search is not enabled instead of embedding nothing quietly", async () => {
    // Default install: no add-on. `--embed` was asked for by name, so silence
    // here would read as "done", and the old path threw from deep inside the
    // provider instead.
    const drain = vi.spyOn(SqliteHandoffIndex.prototype, "embedBacklog");
    const saved = {
      dir: process.env.XTCTX_EMBEDDING_RUNTIME_DIR,
      disable: process.env.XTCTX_DISABLE_EMBEDDINGS,
      home: process.env.HOME,
      profile: process.env.USERPROFILE,
    };
    // Home at an empty directory so the developer's own install cannot make
    // the add-on look present.
    delete process.env.XTCTX_EMBEDDING_RUNTIME_DIR;
    process.env.XTCTX_DISABLE_EMBEDDINGS = "0";
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    const errors: string[] = [];
    const write = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    try {
      await runScan({ projectPath: projectRoot, embed: true });
      expect(process.exitCode).toBe(1);
    } finally {
      write.mockRestore();
      process.exitCode = 0;
      restoreEnv("XTCTX_EMBEDDING_RUNTIME_DIR", saved.dir);
      restoreEnv("XTCTX_DISABLE_EMBEDDINGS", saved.disable);
      restoreEnv("HOME", saved.home);
      restoreEnv("USERPROFILE", saved.profile);
    }

    expect(errors.join("")).toContain("xtctx embeddings enable");
    expect(drain).not.toHaveBeenCalled();
  }, 60_000);

  it("refuses an unconfigured project rather than embedding into one", async () => {
    // The same refusal the plain scan makes. A flag must not become a way to
    // create an index somewhere nobody opted in.
    const bare = await mkdtemp(join(tmpdir(), "xtctx-scan-embed-bare-"));
    const drain = vi.spyOn(SqliteHandoffIndex.prototype, "embedBacklog");
    try {
      await runScan({ projectPath: bare, embed: true });

      expect(drain).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      await rm(bare, { recursive: true, force: true });
    }
  }, 60_000);
});
