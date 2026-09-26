import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { writeFileAtomic } from "../utils/atomic-file.js";
import { parse as parseYaml } from "yaml";
import { SUPPORTED_TOOLS, type SkillSyncMode, type ToolId } from "../tools/sources.js";

export const BUILT_IN_SKILL_ID = "xtctx-handoff";

interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
  content: string;
}

export interface SkillSelection {
  id: string;
  hash: string;
  source: string;
  path: string;
}

interface SkillTargetState {
  mode: SkillSyncMode;
  path?: string;
}

export interface ProjectSkillConfig {
  sourceDir: string;
  selected: Record<string, { hash: string; source: string }>;
  targets: Record<string, SkillTargetState>;
}

interface SkillSyncResult {
  config: ProjectSkillConfig;
  selected: SkillSelection[];
  writes: Array<{ path: string; kind: string; changed: boolean }>;
  warnings: string[];
}

interface SkillStatus {
  sourceDir: string;
  selected: Array<{
    id: string;
    exists: boolean;
    hash?: string;
    /**
     * The built-in skill's canonical copy no longer matches the one this
     * version ships.
     *
     * Only ever set for `xtctx-handoff`. Setup copies the built-in text into
     * `.xtctx/skills/` once, and everything afterwards compares the synced
     * targets against THAT copy — so a project set up before the text changed
     * keeps the old wording, every target agrees with it, and status reports
     * `ok`. That is how a skill telling agents "no xtctx setup is required"
     * survived in projects after the claim was corrected, while the server
     * refuses every tool in an unconfigured project.
     *
     * The skill is instructions to an agent, so a stale copy is not cosmetic:
     * it is an instruction to keep calling tools that will not answer.
     */
    staleBuiltIn?: boolean;
  }>;
  targets: Array<{
    tool: ToolId;
    mode: SkillSyncMode;
    skillId?: string;
    path?: string;
    state: "ok" | "missing" | "drift" | "unsupported" | "managed-block";
  }>;
}

interface ExistingSkillConfig {
  selectedIds: string[];
  /**
   * Where each selected skill was discovered, project-relative, as setup
   * recorded it in `skills.selected.<id>.source`.
   *
   * Read back at disconnect to tell a file xtctx generated from one the user
   * wrote. For `native-skill` mode the synced copy is byte-identical to the
   * canonical one, so a content hash cannot separate them — the copy matches
   * precisely because xtctx made it from that file.
   */
  sources: Record<string, string>;
}

interface SkillSyncOptions {
  projectRoot: string;
  configPath: string;
  selectedSkillIds?: string[];
  homeDir?: string;
  /** Tools the project has switched off; nothing is synced to them. */
  disabledTools?: ReadonlySet<string>;
}

const HASH_PREFIX = "sha256:";
const SKILL_HASH_PATTERN = /xtctx:skill-hash\s+([a-z0-9:]+)/i;

export async function syncProjectSkills(options: SkillSyncOptions): Promise<SkillSyncResult> {
  const projectRoot = resolve(options.projectRoot);
  const sourceDir = skillSourceDir(projectRoot);
  const existing = await readExistingSkillConfig(options.configPath);
  const discovered = await discoverProjectSkills({ projectRoot, homeDir: options.homeDir });
  const selectedIds = resolveSelectedSkillIds(existing, options.selectedSkillIds);
  const writes: SkillSyncResult["writes"] = [];
  const warnings: string[] = [];

  await mkdir(sourceDir, { recursive: true });

  for (const skillId of selectedIds) {
    const sourcePath = join(sourceDir, skillId, "SKILL.md");
    const discoveredSkill = discovered.find((skill) => skill.id === skillId);
    const content = skillId === BUILT_IN_SKILL_ID ? builtInHandoffSkill() : discoveredSkill?.content;

    if (!content) {
      warnings.push(`Selected skill ${skillId} was not found in connected tool skill sources.`);
      continue;
    }

    writes.push({
      path: sourcePath,
      kind: `skill-source:${skillId}`,
      changed: await writeIfChanged(sourcePath, content, projectRoot),
    });
  }

  const selected = await readSelectedSkills(sourceDir, selectedIds);
  const disabled = options.disabledTools ?? new Set<string>();
  const targetConfig = Object.fromEntries(
    Object.entries(buildTargetConfig(projectRoot)).filter(([tool]) => !disabled.has(tool)),
  );

  // Where each skill came from, for disconnect's "is this the user's own
  // file?" guard. It recorded the canonical copy's path, `.xtctx/skills/...`,
  // which is never a sync target, so the guard never fired and `disconnect
  // claude-code` deleted a user's own `.claude/skills/<id>/SKILL.md`. The
  // origin is recorded once, when the skill is first found, and kept: on
  // every later run discovery finds the canonical copy first.
  const origins = new Map<string, string>();
  for (const skill of selected) {
    origins.set(
      skill.id,
      await skillOrigin(projectRoot, skill, existing.sources[skill.id], discovered),
    );
  }

  for (const skill of selected) {
    for (const tool of SUPPORTED_TOOLS) {
      if (disabled.has(tool.id)) {
        continue;
      }
      const capability = tool.skillSync;
      if (!capability || capability.mode === "unsupported" || capability.mode === "managed-block") {
        continue;
      }

      const targetPath = capability.targetPath?.(projectRoot, skill.id);
      if (!targetPath) {
        continue;
      }

      const write = await syncSkillToTarget({
        skill,
        mode: capability.mode,
        targetPath,
        // Every skill target path is built from `projectRoot`, so that is the
        // root the write must stay inside.
        containWithin: projectRoot,
      });
      writes.push({ path: write.path, kind: `skill:${tool.id}:${skill.id}`, changed: write.changed });
    }
  }

  for (const tool of SUPPORTED_TOOLS.filter((item) => item.skillSync?.mode === "unsupported")) {
    warnings.push(`${tool.label} has no verified native skill or instruction surface; skill sync is not installed there.`);
  }

  return {
    config: {
      sourceDir: ".xtctx/skills",
      selected: Object.fromEntries(
        selected.map((skill) => [skill.id, { hash: skill.hash, source: origins.get(skill.id) ?? toProjectRelative(projectRoot, skill.path) }]),
      ),
      targets: targetConfig,
    },
    selected,
    writes,
    warnings,
  };
}

export async function discoverProjectSkills(options: {
  projectRoot: string;
  homeDir?: string;
}): Promise<DiscoveredSkill[]> {
  const projectRoot = resolve(options.projectRoot);
  const home = options.homeDir ?? process.env.USERPROFILE ?? process.env.HOME ?? "";
  const codexHome = process.env.CODEX_HOME ?? (home ? join(home, ".codex") : "");
  const candidates = [
    { source: "xtctx", root: skillSourceDir(projectRoot) },
    { source: "claude-code project", root: join(projectRoot, ".claude", "skills") },
    { source: "claude-code user", root: home ? join(home, ".claude", "skills") : "" },
    { source: "codex project", root: join(projectRoot, ".codex", "skills") },
    { source: "codex user", root: codexHome ? join(codexHome, "skills") : "" },
  ].filter((candidate) => candidate.root.length > 0);

  const discovered: DiscoveredSkill[] = [
    parseSkillContent(BUILT_IN_SKILL_ID, builtInHandoffSkill(), "<built-in>", "xtctx built-in"),
  ];

  for (const candidate of candidates) {
    const entries = await readSkillDir(candidate.root, candidate.source);
    for (const entry of entries) {
      if (!discovered.some((skill) => skill.id === entry.id)) {
        discovered.push(entry);
      }
    }
  }

  return discovered.sort((left, right) => left.id.localeCompare(right.id));
}

export async function inspectSkillStatus(
  projectRoot: string,
  configPath: string,
  /** Switched off in the project's config: not reported, so not "missing". */
  disabledTools: ReadonlySet<string> = new Set(),
): Promise<SkillStatus> {
  const root = resolve(projectRoot);
  const sourceDir = skillSourceDir(root);
  const existing = await readExistingSkillConfig(configPath);
  const selectedIds = resolveSelectedSkillIds(existing);
  const selected = await Promise.all(
    selectedIds.map(async (id) => {
      const path = join(sourceDir, id, "SKILL.md");
      const content = await readUtf8IfExists(path);
      const staleBuiltIn =
        id === BUILT_IN_SKILL_ID &&
        content !== null &&
        hashContent(content) !== hashContent(builtInHandoffSkill());
      return {
        id,
        exists: content !== null,
        hash: content ? hashContent(content) : undefined,
        ...(staleBuiltIn ? { staleBuiltIn: true } : {}),
      };
    }),
  );

  const targets: SkillStatus["targets"] = [];
  for (const tool of SUPPORTED_TOOLS) {
    if (disabledTools.has(tool.id)) {
      continue;
    }
    const capability = tool.skillSync;
    const mode = capability?.mode ?? "unsupported";

    if (mode === "unsupported") {
      targets.push({ tool: tool.id, mode, state: "unsupported" });
      continue;
    }

    if (mode === "managed-block") {
      targets.push({
        tool: tool.id,
        mode,
        path: capability?.targetPath?.(root, BUILT_IN_SKILL_ID),
        state: "managed-block",
      });
      continue;
    }

    for (const skill of selected) {
      const targetPath = capability?.targetPath?.(root, skill.id);
      if (!targetPath) {
        targets.push({ tool: tool.id, mode, skillId: skill.id, state: "unsupported" });
        continue;
      }

      const content = await readUtf8IfExists(targetPath);
      let state: "ok" | "missing" | "drift" = "missing";
      if (content !== null && skill.hash) {
        state = targetHasHash(content, skill.hash, mode) ? "ok" : "drift";
      }
      targets.push({ tool: tool.id, mode, skillId: skill.id, path: targetPath, state });
    }
  }

  return { sourceDir, selected, targets };
}

export async function removeSyncedSkillsForTools(
  projectRoot: string,
  tools: ToolId[],
): Promise<Array<{ path: string; kind: string; changed: boolean }>> {
  const root = resolve(projectRoot);
  const writes: Array<{ path: string; kind: string; changed: boolean }> = [];
  const selectedIds = await listCanonicalSkillIds(skillSourceDir(root));
  // Where each skill came from. A skill discovered in `.claude/skills/` syncs
  // back to that same path under `native-skill` mode, so without this the
  // user's own file is deleted by a disconnect that only ever meant to remove
  // what xtctx generated.
  const { sources } = await readExistingSkillConfig(join(root, ".xtctx", "config.yaml"));

  for (const toolId of tools) {
    const tool = SUPPORTED_TOOLS.find((item) => item.id === toolId);
    const capability = tool?.skillSync;
    if (!capability || capability.mode === "unsupported" || capability.mode === "managed-block") {
      continue;
    }

    for (const skillId of selectedIds) {
      const targetPath = capability.targetPath?.(root, skillId);
      if (!targetPath) {
        continue;
      }

      if (isUserAuthoredTarget(root, sources[skillId], targetPath)) {
        writes.push({ path: targetPath, kind: `skill:${toolId}:${skillId}:kept`, changed: false });
        continue;
      }

      const changed = await removePath(targetPath);
      writes.push({ path: targetPath, kind: `skill:${toolId}:${skillId}`, changed });
    }
  }

  return writes;
}

/**
 * True when the file this tool syncs to is the same file the skill was
 * discovered from — so removing it would delete the user's original rather
 * than a copy xtctx made.
 *
 * `source` is absent for the built-in skill (recorded as `<built-in>`) and for
 * any project set up before it was written, and in both of those cases the
 * target is xtctx's to remove.
 */
function isUserAuthoredTarget(
  projectRoot: string,
  source: string | undefined,
  targetPath: string,
): boolean {
  if (!source || source === "<built-in>") {
    return false;
  }
  return resolve(projectRoot, source) === resolve(targetPath);
}

export function renderSyncedSkillsBlock(selected: SkillSelection[]): string[] {
  if (selected.length === 0) {
    return [];
  }

  return [
    "## Synced Skills",
    "- Canonical project skills live in `.xtctx/skills`.",
    "- If a task matches a synced skill, read that skill file before following it.",
    ...selected.map((skill) => `- ${skill.id}: \`.xtctx/skills/${skill.id}/SKILL.md\``),
    "",
  ];
}

function resolveSelectedSkillIds(existing: ExistingSkillConfig, explicit?: string[]): string[] {
  const ids = explicit && explicit.length > 0 ? explicit : existing.selectedIds;
  return uniqueIds([BUILT_IN_SKILL_ID, ...ids]);
}

async function readSelectedSkills(sourceDir: string, selectedIds: string[]): Promise<SkillSelection[]> {
  const selected: SkillSelection[] = [];
  for (const id of selectedIds) {
    const path = join(sourceDir, id, "SKILL.md");
    const content = await readUtf8IfExists(path);
    if (content === null) {
      continue;
    }
    selected.push({ id, path, source: toPosixPath(path), hash: hashContent(content) });
  }
  return selected;
}

async function syncSkillToTarget(input: {
  skill: SkillSelection;
  mode: SkillSyncMode;
  targetPath: string;
  containWithin: string;
}): Promise<{ path: string; changed: boolean }> {
  const content = await readFile(input.skill.path, "utf-8");
  const parsed = parseSkillContent(input.skill.id, content, input.skill.path, "xtctx");
  const rendered = renderTargetContent({
    skill: parsed,
    sourceHash: input.skill.hash,
    mode: input.mode,
    content,
  });
  return {
    path: input.targetPath,
    changed: await writeIfChanged(input.targetPath, rendered, input.containWithin),
  };
}

function renderTargetContent(input: {
  skill: DiscoveredSkill;
  sourceHash: string;
  mode: SkillSyncMode;
  content: string;
}): string {
  if (input.mode === "native-skill") {
    return `${normalizeNewlines(input.content).trimEnd()}\n`;
  }

  const title = input.skill.name || input.skill.id;
  const header = [
    "<!-- xtctx:skill begin -->",
    `<!-- xtctx:skill-id ${input.skill.id} -->`,
    `<!-- xtctx:skill-hash ${input.sourceHash} -->`,
    "Generated by xtctx setup. Do not edit this file directly.",
    "",
  ].join("\n");
  const body = stripFrontmatter(input.content).trim();
  const footer = "\n\n<!-- xtctx:skill end -->\n";

  if (input.mode === "rule-adapter") {
    return [
      "---",
      `description: ${quoteYamlString(`${input.skill.description} Synced from xtctx project skills.`)}`,
      'globs: "**/*"',
      "alwaysApply: false",
      "---",
      "",
      header,
      `# ${title}`,
      "",
      body,
      footer,
    ].join("\n");
  }

  if (input.mode === "instruction-adapter") {
    return [
      "---",
      'applyTo: "**"',
      "---",
      "",
      header,
      `# ${title}`,
      "",
      body,
      footer,
    ].join("\n");
  }

  switch (input.mode) {
    case "managed-block":
    case "unsupported":
      return input.content;
    default: {
      const _exhaustive: never = input.mode;
      void _exhaustive;
      return input.content;
    }
  }
}

function targetHasHash(content: string, hash: string, mode: SkillSyncMode): boolean {
  if (mode === "native-skill") {
    return hashContent(content.replace(/\n?$/, "\n")) === hash;
  }

  const match = SKILL_HASH_PATTERN.exec(content);
  return match?.[1] === hash;
}

async function readExistingSkillConfig(configPath: string): Promise<ExistingSkillConfig> {
  const raw = await readUtf8IfExists(configPath);
  if (raw === null) {
    return { selectedIds: [], sources: {} };
  }

  try {
    const parsed = parseYaml(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.skills) || !isRecord(parsed.skills.selected)) {
      return { selectedIds: [], sources: {} };
    }

    const selected = parsed.skills.selected;
    const sources: Record<string, string> = {};
    for (const [id, entry] of Object.entries(selected)) {
      if (isRecord(entry) && typeof entry.source === "string") {
        sources[id] = entry.source;
      }
    }

    return { selectedIds: Object.keys(selected), sources };
  } catch {
    return { selectedIds: [], sources: {} };
  }
}

async function readSkillDir(root: string, source: string): Promise<DiscoveredSkill[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const skills: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillId = normalizeSkillId(entry.name);
    if (!skillId) {
      continue;
    }

    const skillPath = join(root, entry.name, "SKILL.md");
    const content = await readUtf8IfExists(skillPath);
    if (!content) {
      continue;
    }

    skills.push(parseSkillContent(skillId, content, skillPath, source));
  }

  return skills;
}

function parseSkillContent(id: string, content: string, path: string, source: string): DiscoveredSkill {
  const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(normalizeNewlines(content));
  let name = id;
  let description = `Synced project skill ${id}`;

  if (frontmatter) {
    try {
      const parsed = parseYaml(frontmatter[1]) as unknown;
      if (isRecord(parsed)) {
        if (typeof parsed.name === "string" && parsed.name.trim()) {
          name = parsed.name.trim();
        }
        if (typeof parsed.description === "string" && parsed.description.trim()) {
          description = parsed.description.trim();
        }
      }
    } catch {
      // Invalid skill frontmatter should not stop setup from repairing other surfaces.
    }
  }

  return { id, name, description, path, source, content: normalizeNewlines(content) };
}

function stripFrontmatter(content: string): string {
  return normalizeNewlines(content).replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function buildTargetConfig(projectRoot: string): Record<string, SkillTargetState> {
  return Object.fromEntries(
    SUPPORTED_TOOLS.map((tool) => [
      tool.id,
      {
        mode: tool.skillSync?.mode ?? "unsupported",
        path: tool.skillSync?.targetPath
          ? toProjectRelative(projectRoot, tool.skillSync.targetPath(projectRoot, BUILT_IN_SKILL_ID))
          : undefined,
      },
    ]),
  );
}

async function listCanonicalSkillIds(sourceDir: string): Promise<string[]> {
  const entries = await readSkillDir(sourceDir, "xtctx");
  return entries.map((entry) => entry.id);
}

/**
 * The handoff skill `setup` writes into `.xtctx/skills`.
 *
 * Exported because the plugin package under `plugin/` ships the same skill as
 * a committed file, and a plugin whose skill has drifted from the one setup
 * writes would tell two agents different things about the same tool.
 * @internal Reached only by tests and `scripts/sync-plugin-skill.mjs`.
 */
export function builtInHandoffSkill(): string {
  return [
    "---",
    "name: xtctx-handoff",
    "description: Retrieve cross-tool handoff context with the xtctx MCP tools. Use when switching AI coding tools, resuming work another agent started, or picking up a project without knowing what was last done in it. Available in any project; retrieval needs `xtctx setup` to have been run there, and the tools say so when it has not.",
    "---",
    "",
    "# xtctx Handoff",
    "",
    "Use the xtctx MCP tools to retrieve recent local transcript context for this project.",
    "",
    "The project is resolved from the working directory. A project that has not",
    "been set up has no index to read, so every tool answers with that and names",
    "`xtctx setup` — offer it rather than reporting that there is no history.",
    "",
    "## Workflow",
    "",
    "1. Call `xtctx_recent_sessions` to list recent sessions for the current project.",
    "2. Call `xtctx_session_detail` with a relevant `session_ref` before continuing the work.",
    "3. Call `xtctx_search_sessions` when keyword or semantic search is more useful than recency.",
    "4. Use `xtctx_continuity_status` only for wiring, cache, and freshness diagnostics.",
    "",
    "The first call in a project with a large history builds the index and returns",
    "with whatever has landed so far while the scan continues in the background. A",
    "thin first result means the index is still filling, not that the history is",
    "empty — call again rather than concluding there is nothing to recover.",
    "",
    "Raw transcript files remain authoritative. Do not invent a summary when raw detail is available.",
    "",
  ].join("\n");
}

function skillSourceDir(projectRoot: string): string {
  return join(projectRoot, ".xtctx", "skills");
}

function hashContent(content: string): string {
  return `${HASH_PREFIX}${createHash("sha256").update(normalizeNewlines(content).trimEnd() + "\n").digest("hex")}`;
}

/**
 * `containWithin` is passed by every caller rather than defaulted: every skill
 * write here is project-scoped, but making the root explicit is what stops a
 * later home-scoped caller from silently inheriting the wrong one.
 */
async function writeIfChanged(
  filePath: string,
  content: string,
  containWithin: string,
): Promise<boolean> {
  const normalized = normalizeNewlines(content);
  const existing = await readUtf8IfExists(filePath);
  if (existing !== null && normalizeNewlines(existing) === normalized) {
    return false;
  }

  await writeFileAtomic(filePath, normalized, { containWithin });
  return true;
}

async function removePath(path: string): Promise<boolean> {
  if (!(await pathExists(path))) {
    return false;
  }

  await rm(path, { force: true });
  return true;
}

async function readUtf8IfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeSkillId(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeSkillId).filter((id): id is string => Boolean(id)))];
}

/** Recorded for a skill found outside the project, which no sync target can be. */
const USER_LEVEL_SOURCE = "<user-level>";

/**
 * Where a selected skill came from, as `skills.selected.<id>.source`.
 *
 * Kept when already recorded. Otherwise -- a first setup, or a project where
 * an earlier version recorded the canonical path by mistake -- a copy in a
 * tool's own project skills folder is taken to be the user's. After an
 * earlier setup that copy may be one xtctx wrote; then disconnect leaves one
 * file behind, which is the safe way to be wrong, where the other way deletes
 * the user's only copy. A skill found in the user's home is recorded as
 * `<user-level>`, not by its path: that would put the username into a
 * committable file.
 */
async function skillOrigin(
  projectRoot: string,
  skill: SkillSelection,
  recorded: string | undefined,
  discovered: DiscoveredSkill[],
): Promise<string> {
  const canonical = toProjectRelative(projectRoot, skill.path);
  if (skill.id === BUILT_IN_SKILL_ID) {
    return canonical;
  }
  if (recorded && recorded !== canonical) {
    return recorded;
  }
  for (const folder of [[".claude", "skills"], [".codex", "skills"]]) {
    const candidate = join(projectRoot, ...folder, skill.id, "SKILL.md");
    if ((await readUtf8IfExists(candidate)) !== null) {
      return toProjectRelative(projectRoot, candidate);
    }
  }
  const found = discovered.find((entry) => entry.id === skill.id);
  if (found && found.path !== "<built-in>" && relative(projectRoot, found.path).startsWith("..")) {
    return USER_LEVEL_SOURCE;
  }
  return canonical;
}

function toProjectRelative(projectRoot: string, path: string): string {
  const rel = relative(projectRoot, path);
  if (!rel.startsWith("..")) {
    return toPosixPath(rel);
  }
  return toPosixPath(path);
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
