/**
 * What `xtctx setup` tells the person who ran it.
 *
 * Nothing pinned this. The report said "updated" for all eighteen files in a
 * fresh project, named the instruction files "memory" (the one thing the
 * product says it does not keep), and closed on "All 7 supported tools were
 * wired" when Copilot CLI is not wired without --global-mcp. Each is a claim a
 * first-time user reads as fact.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "@xtctx/config/setup";

describe("the setup report", () => {
  let projectRoot = "";
  let homeDir = "";
  let printed = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "xtctx-report-project-"));
    homeDir = await mkdtemp(join(tmpdir(), "xtctx-report-home-"));
    printed = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      printed += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("says created for files that were not there, and unchanged on a re-run", async () => {
    await runSetup({ projectPath: projectRoot, homeDir, yes: true });

    expect(printed).toMatch(/xtctx setup complete: \d+ created, 0 updated, 0 unchanged/);
    expect(printed).toMatch(/^ {2}created +config +\.xtctx[\\/]config\.yaml$/m);
    expect(printed).not.toMatch(/^ {2}updated /m);

    printed = "";
    await runSetup({ projectPath: projectRoot, homeDir, yes: true });

    expect(printed).toMatch(/xtctx setup complete: 0 created, 0 updated, \d+ unchanged/);
  });

  it("says updated, and only for the files that already existed", async () => {
    // The other half of "created": a report that says created for everything it
    // changed would pass the fresh-project test above. These three are files a
    // user already has — instructions they wrote, an MCP config naming another
    // server, a settings file with their own rule — and setup edits them
    // rather than making them.
    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(join(projectRoot, "CLAUDE.md"), "# My project rules\n", "utf-8");
    await writeFile(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "utf-8",
    );
    await writeFile(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }),
      "utf-8",
    );

    await runSetup({ projectPath: projectRoot, homeDir, yes: true });

    expect(printed).toMatch(/^ {2}updated +instructions:claude-code +CLAUDE\.md$/m);
    expect(printed).toMatch(/^ {2}updated +mcp:claude-code +\.mcp\.json$/m);
    expect(printed).toMatch(/^ {2}updated +hook:claude-code +\.claude[\\/]settings\.json$/m);
    expect(printed).toMatch(/^ {2}created +instructions:codex +AGENTS\.md$/m);
    expect(printed).toMatch(/xtctx setup complete: \d+ created, 3 updated, 0 unchanged/);
  });

  it("calls the instruction files instructions, not memory", async () => {
    await runSetup({ projectPath: projectRoot, homeDir, yes: true });

    expect(printed).toMatch(/instructions:claude-code +CLAUDE\.md/);
    expect(printed).not.toContain("memory:");
  });

  it("counts the tools it wired instead of claiming all of them", async () => {
    await runSetup({ projectPath: projectRoot, homeDir, yes: true });

    expect(printed).toContain("6 of 7 supported tools were wired");
    expect(printed).toContain("xtctx setup --global-mcp");
    expect(printed).not.toContain("All 7 supported tools were wired");

    printed = "";
    await runSetup({ projectPath: projectRoot, homeDir, yes: true, includeGlobalMcp: true });

    expect(printed).toContain("All 7 supported tools were wired");
  });
});
