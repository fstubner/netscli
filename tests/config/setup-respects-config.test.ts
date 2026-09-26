/**
 * Setup merges into the project's config and respects what it says.
 *
 * It used to rewrite `.xtctx/config.yaml` from scratch: a hand-set
 * `storePath`, the `embedding:` block and every `enabled: false` were lost,
 * the last including the ones `disconnect` writes. `status` then called the
 * disconnected tool "out of date" and sent people to `setup`, which wired it
 * straight back in. Separately, the provenance setup recorded for a
 * user-authored skill was the canonical copy's path, so `disconnect
 * claude-code` deleted the user's own `.claude/skills/<id>/SKILL.md`.
 *
 * Each case goes through the real entry points -- setup, disconnect, status --
 * rather than a hand-written config, which is how the skill guard's own unit
 * test kept passing while the round trip deleted the file.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { setupProject } from "@xtctx/config/setup";
import { disconnectProject } from "@xtctx/config/disconnect";
import { renderStatusBlock } from "@xtctx/cli/status";
import { createProjectServices } from "@xtctx/runtime/services";

let projectRoot = "";
let homeDir = "";

beforeEach(async () => {
  projectRoot = await realpath(await mkdtemp(join(tmpdir(), "xtctx-respect-project-")));
  homeDir = await realpath(await mkdtemp(join(tmpdir(), "xtctx-respect-home-")));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectRoot, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

const configPath = () => join(projectRoot, ".xtctx", "config.yaml");
interface ProjectConfig {
  tools: Record<string, Record<string, unknown>>;
  skills: { selected: Record<string, { source?: string }> };
  [key: string]: unknown;
}
const readConfig = async () => parseYaml(await readFile(configPath(), "utf-8")) as ProjectConfig;

describe("setup and the project's config", () => {
  it("keeps storePath, embedding, enabled: false and unknown keys, and drops the absolute root", async () => {
    await setupProject({ projectPath: projectRoot, homeDir });
    const config = await readConfig();
    config.tools.codex.storePath = "/custom/codex/sessions";
    config.tools.cursor.enabled = false;
    config.embedding = { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "nomic" };
    config.team = { note: "kept" };
    const { stringify } = await import("yaml");
    await writeFile(configPath(), stringify(config), "utf-8");

    await setupProject({ projectPath: projectRoot, homeDir });
    const after = await readConfig();

    expect(after.tools.codex.storePath).toBe("/custom/codex/sessions");
    expect(after.tools.cursor.enabled).toBe(false);
    expect(after.embedding).toEqual(config.embedding);
    expect(after.team).toEqual({ note: "kept" });
    // Unread, and it put the username into a committable file.
    expect(after.project).toBeUndefined();
    expect(await readFile(configPath(), "utf-8")).not.toContain(projectRoot);
  });

  it("refuses to touch anything when the config does not parse", async () => {
    await setupProject({ projectPath: projectRoot, homeDir });
    await writeFile(configPath(), "tools: [oops\n", "utf-8");
    await rm(join(projectRoot, "CLAUDE.md"));

    const result = await setupProject({ projectPath: projectRoot, homeDir });

    expect(result.failures.join("\n")).toMatch(/could not be parsed, so setup changed nothing/);
    expect(await readFile(configPath(), "utf-8")).toBe("tools: [oops\n");
    expect(existsSync(join(projectRoot, "CLAUDE.md"))).toBe(false);
  });
});

describe("a disconnected tool stays disconnected", () => {
  it("is not rewired by a later setup, and status does not ask for one", async () => {
    await setupProject({ projectPath: projectRoot, homeDir });
    await disconnectProject({ projectPath: projectRoot, tool: "cursor", homeDir });

    const services = await createProjectServices(projectRoot, { createIfMissing: false });
    let status: string;
    try {
      status = await renderStatusBlock(services, { homeDir });
    } finally {
      await services.sessions.close();
    }
    expect(status).not.toMatch(/Out of date: .*cursor/);

    const result = await setupProject({ projectPath: projectRoot, homeDir });

    expect(existsSync(join(projectRoot, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(projectRoot, ".cursor", "rules", "xtctx.mdc"))).toBe(false);
    expect(existsSync(join(projectRoot, ".cursor", "rules", "xtctx-skills"))).toBe(false);
    expect(result.writes.some((write) => write.kind.includes("cursor"))).toBe(false);
    expect((await readConfig()).tools.cursor.enabled).toBe(false);
    // Everything else is still wired.
    expect(existsSync(join(projectRoot, ".mcp.json"))).toBe(true);
  });

  it("keeps a shared instruction file while another tool still reads it", async () => {
    await setupProject({ projectPath: projectRoot, homeDir });
    await disconnectProject({ projectPath: projectRoot, tool: "codex", homeDir });

    await setupProject({ projectPath: projectRoot, homeDir });

    // AGENTS.md is opencode's instruction file too.
    expect(await readFile(join(projectRoot, "AGENTS.md"), "utf-8")).toContain("xtctx:begin");
    expect(existsSync(join(projectRoot, ".codex", "config.toml"))).toBe(false);
  });
});

describe("a skill the user wrote", () => {
  const USER_SKILL = "---\nname: my-skill\ndescription: mine\n---\n\n# Mine\n";

  it("survives setup, a second setup, and disconnect claude-code", async () => {
    const own = join(projectRoot, ".claude", "skills", "my-skill", "SKILL.md");
    await mkdir(join(projectRoot, ".claude", "skills", "my-skill"), { recursive: true });
    await writeFile(own, USER_SKILL, "utf-8");

    await setupProject({
      projectPath: projectRoot,
      homeDir,
      yes: true,
      selectedSkillIds: ["xtctx-handoff", "my-skill"],
    });
    // The second run discovers the canonical copy first; the recorded origin
    // must survive it.
    await setupProject({ projectPath: projectRoot, homeDir });
    expect((await readConfig()).skills.selected["my-skill"].source).toBe(".claude/skills/my-skill/SKILL.md");

    await disconnectProject({ projectPath: projectRoot, tool: "claude-code", homeDir });

    await expect(readFile(own, "utf-8")).resolves.toBe(USER_SKILL);
  });

  it("is protected in a project an earlier version set up, which recorded the canonical path", async () => {
    const own = join(projectRoot, ".claude", "skills", "my-skill", "SKILL.md");
    await mkdir(join(projectRoot, ".claude", "skills", "my-skill"), { recursive: true });
    await writeFile(own, USER_SKILL, "utf-8");
    await setupProject({ projectPath: projectRoot, homeDir, selectedSkillIds: ["xtctx-handoff", "my-skill"] });
    // What the previous version wrote.
    const text = await readFile(configPath(), "utf-8");
    await writeFile(
      configPath(),
      text.replace("source: .claude/skills/my-skill/SKILL.md", "source: .xtctx/skills/my-skill/SKILL.md"),
      "utf-8",
    );

    await setupProject({ projectPath: projectRoot, homeDir });
    await disconnectProject({ projectPath: projectRoot, tool: "claude-code", homeDir });

    await expect(readFile(own, "utf-8")).resolves.toBe(USER_SKILL);
  });

  it("found in the user's home is recorded without the home path", async () => {
    await mkdir(join(homeDir, ".claude", "skills", "home-skill"), { recursive: true });
    await writeFile(join(homeDir, ".claude", "skills", "home-skill", "SKILL.md"), USER_SKILL, "utf-8");

    await setupProject({ projectPath: projectRoot, homeDir, selectedSkillIds: ["xtctx-handoff", "home-skill"] });

    expect((await readConfig()).skills.selected["home-skill"].source).toBe("<user-level>");
    expect(await readFile(configPath(), "utf-8")).not.toContain(homeDir.replace(/\\/g, "/"));
  });
});
