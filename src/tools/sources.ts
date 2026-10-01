import { existsSync } from "node:fs";
import { join } from "node:path";
import { AntigravityScraper } from "../scrapers/antigravity.js";
import { ClaudeCodeScraper } from "../scrapers/claude-code.js";
import { CodexCliScraper } from "../scrapers/codex.js";
import { CopilotCliScraper } from "../scrapers/copilot-cli.js";
import { CopilotScraper } from "../scrapers/copilot.js";
import { CursorScraper } from "../scrapers/cursor.js";
import { OpenCodeScraper } from "../scrapers/opencode.js";
import type { ConversationScraper } from "../types/scraper.js";

export type ToolId =
  | "claude-code"
  | "cursor"
  | "codex"
  | "copilot"
  | "antigravity"
  | "opencode"
  | "copilot-cli";

export type HookMode = "executable" | "instruction-only" | "mcp-only";
export type SkillSyncMode =
  | "native-skill"
  | "rule-adapter"
  | "instruction-adapter"
  | "managed-block"
  | "unsupported";

interface ToolSkillCapability {
  mode: SkillSyncMode;
  targetPath?: (projectRoot: string, skillId: string) => string;
}

interface ToolSourceDefinition {
  id: ToolId;
  label: string;
  defaultStorePath: () => string;
  createScraper: (
    storePath: string,
    stateDir: string,
    projectRoot?: string,
    /**
     * The project's store directory as stated by the tool itself, when it told
     * us. Only Claude Code does today, via the `transcript_path` its hooks
     * receive; the others ignore it and reconstruct as before.
     */
    projectStoreDir?: string,
  ) => ConversationScraper;
  memoryTargets: string[];
  hookMode: HookMode;
  skillSync?: ToolSkillCapability;
}

export const SUPPORTED_TOOLS: ToolSourceDefinition[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    defaultStorePath: defaultClaudeProjectsDir,
    createScraper: (storePath, stateDir, projectRoot, projectStoreDir) =>
      new ClaudeCodeScraper(storePath, stateDir, projectRoot, projectStoreDir),
    memoryTargets: ["CLAUDE.md"],
    hookMode: "executable",
    skillSync: {
      mode: "native-skill",
      targetPath: (projectRoot, skillId) => join(projectRoot, ".claude", "skills", skillId, "SKILL.md"),
    },
  },
  {
    id: "cursor",
    label: "Cursor",
    defaultStorePath: defaultCursorStorePath,
    createScraper: (storePath, stateDir, projectRoot) =>
      new CursorScraper(storePath, stateDir, projectRoot),
    memoryTargets: [join(".cursor", "rules", "xtctx.mdc")],
    hookMode: "instruction-only",
    skillSync: {
      mode: "rule-adapter",
      targetPath: (projectRoot, skillId) => join(projectRoot, ".cursor", "rules", "xtctx-skills", `${skillId}.mdc`),
    },
  },
  {
    id: "codex",
    label: "Codex",
    defaultStorePath: defaultCodexSessionsPath,
    createScraper: (storePath, stateDir, projectRoot) =>
      new CodexCliScraper(storePath, stateDir, projectRoot),
    memoryTargets: ["AGENTS.md"],
    hookMode: "instruction-only",
    skillSync: {
      mode: "managed-block",
      targetPath: (projectRoot) => join(projectRoot, "AGENTS.md"),
    },
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    defaultStorePath: defaultCopilotHistoryPath,
    createScraper: (storePath, stateDir, projectRoot) =>
      new CopilotScraper(storePath, stateDir, projectRoot),
    memoryTargets: [join(".github", "copilot-instructions.md")],
    hookMode: "instruction-only",
    skillSync: {
      mode: "instruction-adapter",
      targetPath: (projectRoot, skillId) =>
        join(projectRoot, ".github", "instructions", `xtctx-${skillId}.instructions.md`),
    },
  },
  {
    id: "antigravity",
    label: "Google Antigravity",
    defaultStorePath: defaultAntigravityStorePath,
    createScraper: (storePath, stateDir, projectRoot) =>
      new AntigravityScraper(storePath, stateDir, projectRoot),
    // Antigravity CLI keeps project-memory compatibility with GEMINI.md.
    memoryTargets: ["GEMINI.md"],
    hookMode: "instruction-only",
    skillSync: {
      mode: "managed-block",
      targetPath: (projectRoot) => join(projectRoot, "GEMINI.md"),
    },
  },
  {
    id: "opencode",
    label: "opencode",
    defaultStorePath: defaultOpenCodeStorePath,
    createScraper: (storePath, stateDir, projectRoot) =>
      new OpenCodeScraper(storePath, stateDir, projectRoot),
    memoryTargets: ["AGENTS.md"],
    hookMode: "instruction-only",
    skillSync: {
      mode: "managed-block",
      targetPath: (projectRoot) => join(projectRoot, "AGENTS.md"),
    },
  },
  {
    id: "copilot-cli",
    label: "GitHub Copilot CLI",
    defaultStorePath: defaultCopilotCliSessionPath,
    createScraper: (storePath, stateDir, projectRoot) =>
      new CopilotCliScraper(storePath, stateDir, projectRoot),
    memoryTargets: [join(".github", "copilot-instructions.md")],
    hookMode: "mcp-only",
    skillSync: {
      mode: "managed-block",
      targetPath: (projectRoot) => join(projectRoot, ".github", "copilot-instructions.md"),
    },
  },
];

export function createDefaultScrapers(
  stateDir: string,
  overrides: Record<string, string | undefined> = {},
  projectRoot?: string,
  /** Per-tool store directories the tool itself named; see `createScraper`. */
  storeDirs: Record<string, string | undefined> = {},
): ConversationScraper[] {
  return SUPPORTED_TOOLS.map((tool) =>
    tool.createScraper(
      overrides[tool.id] ?? tool.defaultStorePath(),
      stateDir,
      projectRoot,
      storeDirs[tool.id],
    ),
  );
}

export function getToolDefinition(toolId: string): ToolSourceDefinition | undefined {
  return SUPPORTED_TOOLS.find((tool) => tool.id === toolId);
}

/** @internal Exported for tests only. */
export function defaultClaudeProjectsDir(): string {
  // `CLAUDE_CONFIG_DIR` moves the whole `.claude` tree, and the hook's
  // containment check is built from this path — so with it set, the real
  // transcript path fell outside the root the hook would accept, the payload
  // naming it was dropped, and the scraper then looked in a `~/.claude` that
  // holds nothing. The hook comment already claimed this variable was
  // followed; nothing read it.
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir && configDir.trim() !== "") {
    return join(configDir, "projects");
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return join(home, ".claude", "projects");
}

/**
 * Cursor is a VS Code fork and keeps `User/workspaceStorage` where VS Code
 * does, so the location is computed the way `defaultCopilotHistoryPath` does
 * it. Without `APPDATA` this used to answer `~/.cursor/workspaceStorage`, a
 * directory that holds Cursor's extensions and settings but no conversations,
 * so on macOS and Linux Cursor read as installed-with-nothing in `status`.
 *
 * The platform and home are parameters so each platform's answer can be
 * checked from any machine.
 * @internal Exported for tests only.
 */
export function defaultCursorStorePath(
  platform: NodeJS.Platform = process.platform,
  home: string = process.env.USERPROFILE ?? process.env.HOME ?? "",
): string {
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Cursor", "User", "workspaceStorage");
  }

  if (platform === "linux") {
    return join(home, ".config", "Cursor", "User", "workspaceStorage");
  }

  return join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage");
}

/** @internal Exported for tests only. */
export function defaultCodexSessionsPath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return join(home, ".codex", "sessions");
}

/** @internal Exported for tests only. */
export function defaultCopilotHistoryPath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Code", "User", "workspaceStorage");
  }

  if (process.platform === "linux") {
    return join(home, ".config", "Code", "User", "workspaceStorage");
  }

  return join(home, "Library", "Application Support", "Code", "User", "workspaceStorage");
}

/** @internal Exported for tests only. */
export function defaultAntigravityStorePath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return join(home, ".gemini", "antigravity");
}

/**
 * opencode does not always store where its host platform suggests: on a
 * Windows machine here it writes to `~/.local/share/opencode/opencode.db`, the
 * XDG location, while the conventional guess was `%APPDATA%\opencode`. A real
 * store with nine sessions was invisible to xtctx as a result, and silently —
 * a wrong default path reports "not detected" forever rather than failing.
 *
 * So the conventional location is preferred but not assumed: whichever
 * candidate actually exists wins, and the conventional one is the fallback so
 * status still names the path a user would expect.
 * @internal Exported for tests only.
 */
export function defaultOpenCodeStorePath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const xdgDataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  const xdg = join(xdgDataHome, "opencode", "opencode.db");

  let conventional: string;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    conventional = join(appData, "opencode", "opencode.db");
  } else if (process.platform === "linux") {
    conventional = xdg;
  } else {
    conventional = join(home, "Library", "Application Support", "opencode", "opencode.db");
  }

  for (const candidate of [conventional, xdg]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return conventional;
}

/** @internal Exported for tests only. */
export function defaultCopilotCliSessionPath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return join(home, ".copilot", "session-state");
}
