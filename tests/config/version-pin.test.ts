/**
 * Generated commands run the xtctx that set the project up, not whatever
 * `latest` is on the day an agent starts.
 *
 * Unpinned, the SessionStart hook cost a registry round-trip on every agent
 * start and could resolve a different version than the MCP server beside it.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderStatusBlock } from "@xtctx/cli/status";
import { setupProject } from "@xtctx/config/setup";
import { createProjectServices } from "@xtctx/runtime/services";
import { readXtctxPackage } from "@xtctx/utils/package-info";

const { version } = readXtctxPackage(import.meta.url);
const HOOK_ARGS = "--hook session-start --tool claude-code";

describe("version pinning", () => {
  let root = "";
  let home = "";

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "xtctx-pin-")));
    home = await realpath(await mkdtemp(join(tmpdir(), "xtctx-pin-home-")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  async function json(path: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return JSON.parse(await readFile(path, "utf-8"));
  }

  const hookCommand = async (): Promise<string> =>
    (await json(join(root, ".claude", "settings.json"))).hooks.SessionStart[0].hooks[0].command;

  it("pins the hook and every MCP entry, project and global, to the running version", async () => {
    await setupProject({ projectPath: root, homeDir: home, yes: true });

    expect(await hookCommand()).toBe(`npx -y xtctx@${version} ${HOOK_ARGS}`);
    expect((await json(join(root, ".mcp.json"))).mcpServers.xtctx.args).toEqual(["-y", `xtctx@${version}`]);
    expect(
      (await json(join(home, ".gemini", "antigravity", "mcp_config.json"))).mcpServers.xtctx.args,
    ).toEqual(["-y", `xtctx@${version}`]);
    // Every generated copy, not just the first one checked.
    for (const file of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
      expect(await readFile(join(root, file), "utf-8")).not.toMatch(/npx -y xtctx(?!@)/);
    }
  });

  it("re-running setup moves an older pin and the unpinned form to the running version", async () => {
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: `npx -y xtctx ${HOOK_ARGS}` }] }] },
      }),
      "utf-8",
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { xtctx: { type: "stdio", command: "npx", args: ["-y", "xtctx@0.0.1"] } } }),
      "utf-8",
    );

    await setupProject({ projectPath: root, homeDir: home, yes: true });

    expect(await hookCommand()).toBe(`npx -y xtctx@${version} ${HOOK_ARGS}`);
    expect((await json(join(root, ".mcp.json"))).mcpServers.xtctx.args).toEqual(["-y", `xtctx@${version}`]);
    expect((await json(join(root, ".claude", "settings.json"))).hooks.SessionStart).toHaveLength(1);
  });

  it("leaves a hook command the user edited by hand alone", async () => {
    const custom = `npx -y xtctx@0.0.1 ${HOOK_ARGS} --extra-flag`;
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: custom }] }] } }),
      "utf-8",
    );

    await setupProject({ projectPath: root, homeDir: home, yes: true });

    expect(await hookCommand()).toBe(custom);
  });

  it("leaves the plugin's own MCP config unpinned, because it follows the plugin's version", async () => {
    const plugin = await json(join(process.cwd(), "plugin", ".mcp.json"));
    expect(plugin.mcpServers.xtctx.args).toEqual(["-y", "xtctx"]);
  });

  describe("status", () => {
    async function status(): Promise<string> {
      const services = await createProjectServices(root);
      try {
        return await renderStatusBlock(services, { homeDir: home });
      } finally {
        await services.sessions.close();
      }
    }

    it("shows the pinned version and that it matches the running one", async () => {
      await setupProject({ projectPath: root, homeDir: home, yes: true });

      expect(await status()).toContain(`Pinned   xtctx@${version} (matches the running version)`);
    });

    it("says when the pin differs from the running version, and what to run", async () => {
      await setupProject({ projectPath: root, homeDir: home, yes: true });
      await writeFile(
        join(root, ".mcp.json"),
        JSON.stringify({ mcpServers: { xtctx: { type: "stdio", command: "npx", args: ["-y", "xtctx@0.0.1"] } } }),
        "utf-8",
      );

      const line = (await status()).split("\n").find((l) => l.startsWith("Pinned"));

      expect(line).toContain("xtctx@0.0.1");
      expect(line).toContain(`running ${version}`);
      expect(line).toContain("xtctx setup --yes");
    });

    it("prints no Pinned line when nothing is pinned", async () => {
      // Every tool but Claude Code switched off, so its two commands are the
      // only ones status reads.
      await mkdir(join(root, ".xtctx"), { recursive: true });
      const others = ["cursor", "codex", "copilot", "antigravity", "opencode", "copilot-cli"];
      await writeFile(
        join(root, ".xtctx", "config.yaml"),
        ["tools:", ...others.flatMap((tool) => [`  ${tool}:`, "    enabled: false"]), ""].join("\n"),
        "utf-8",
      );
      await setupProject({ projectPath: root, homeDir: home, yes: true });
      await writeFile(
        join(root, ".mcp.json"),
        JSON.stringify({ mcpServers: { xtctx: { type: "stdio", command: "node", args: ["x.js"] } } }),
        "utf-8",
      );
      await rm(join(root, ".claude", "settings.json"));

      expect(await status()).not.toMatch(/^Pinned/m);
    });
  });
});
