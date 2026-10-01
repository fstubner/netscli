/**
 * `xtctx status` says when the index holds the only copy of a session.
 *
 * Claude Code deletes transcripts after 30 days by default. From then on the
 * index is the only copy of those sessions, deleting `.xtctx/state` loses
 * them, and nothing in the report said so.
 *
 * End to end through the real Claude Code scraper reading a real store
 * layout. Home, app-data and `CLAUDE_CONFIG_DIR` all point into a temp
 * directory for the whole file, so no real store is read.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderStatusBlock } from "@xtctx/cli/status";
import { setupProject } from "@xtctx/config/setup";
import { createProjectServices } from "@xtctx/runtime/services";
import { encodePathForToolDirectory } from "@xtctx/utils/project-scope";

const ENV_KEYS = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CLAUDE_CONFIG_DIR"] as const;

describe("status and sessions only the index holds", () => {
  let projectRoot = "";
  let homeDir = "";
  let saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    projectRoot = await realpath(await mkdtemp(join(tmpdir(), "xtctx-status-only-")));
    homeDir = await realpath(await mkdtemp(join(tmpdir(), "xtctx-status-only-home-")));
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] as const) {
      process.env[key] = homeDir;
    }
    process.env.CLAUDE_CONFIG_DIR = join(homeDir, ".claude");

    await setupProject({ projectPath: projectRoot, homeDir, yes: true });
    await writeFile(
      join(projectRoot, ".xtctx", "config.yaml"),
      [
        "tools:",
        ...["cursor", "codex", "copilot", "antigravity", "opencode", "copilot-cli"].flatMap((tool) => [
          `  ${tool}:`,
          "    enabled: false",
        ]),
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  const storeDir = (): string =>
    join(homeDir, ".claude", "projects", encodePathForToolDirectory(projectRoot));

  async function writeTranscript(sessionId: string, content: string): Promise<void> {
    await mkdir(storeDir(), { recursive: true });
    await writeFile(
      join(storeDir(), `${sessionId}.jsonl`),
      `${JSON.stringify({ type: "human", content, timestamp: "2026-05-10T10:00:00Z", cwd: projectRoot })}\n`,
      "utf-8",
    );
  }

  async function report(): Promise<string> {
    const services = await createProjectServices(projectRoot, { createIfMissing: false });
    try {
      return await renderStatusBlock(services, { homeDir });
    } finally {
      await services.sessions.close();
    }
  }

  it("counts sessions whose transcript is gone and names the command that keeps them", async () => {
    await writeTranscript("session-kept", "still on disk");
    await writeTranscript("session-aged", "cleaned up after thirty days");
    const services = await createProjectServices(projectRoot);
    await services.sessions.listRecentSessions(10);
    await services.sessions.whenScanSettled();
    expect((await services.sessions.getStatus()).sessions).toBe(2);
    await services.sessions.close();

    expect(await report()).not.toContain("only in this index");

    await rm(join(storeDir(), "session-aged.jsonl"));

    expect(await report()).toContain(
      "Backup   1 session exists only in this index; back it up with `xtctx export`",
    );
  });

  it("claims nothing when the store itself cannot be listed", async () => {
    // A store that is not there at all — moved, unmounted, a changed
    // CLAUDE_CONFIG_DIR — is not evidence that any one transcript was deleted.
    await writeTranscript("session-a", "indexed while the store was readable");
    const services = await createProjectServices(projectRoot);
    await services.sessions.listRecentSessions(10);
    await services.sessions.whenScanSettled();
    await services.sessions.close();

    process.env.CLAUDE_CONFIG_DIR = join(homeDir, "nowhere");

    expect(await report()).not.toContain("only in this index");
  });
});
