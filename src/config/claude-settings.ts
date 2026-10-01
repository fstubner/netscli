import { join } from "node:path";
import { rm } from "node:fs/promises";
import { writeFileAtomic } from "../utils/atomic-file.js";
import { isRecord, readJsonIfExists, readUtf8IfExists, writeIfChanged } from "./file-io.js";
import { SELF_HOSTED_ENTRY, isSelfHostedProject, pinnedPackageSpec } from "./server-definition.js";

/**
 * `.claude/settings.json` — the one file where xtctx registers a SessionStart
 * hook and grants itself tool permissions.
 *
 * Setup writes those two things and disconnect takes exactly them back, so the
 * marker that identifies our hook and the list of permissions we grant are
 * defined once, here, next to both halves. Disconnect used to carry its own
 * hardcoded copy of the marker, which is exactly how the two drift apart.
 */

/**
 * Substring identifying an xtctx SessionStart hook, whatever invokes it.
 *
 * Deliberately does NOT include "xtctx": the self-hosted form runs
 * `node ./dist/src/cli/index.js`, which contains no such token. Keeping the
 * old marker would have made setup append a second hook on every run and left
 * disconnect unable to remove either — so the marker has to identify the flag,
 * not the launcher. It is only ever matched against SessionStart hook
 * commands, which bounds how broad this is.
 */
export const CLAUDE_HOOK_MARKER = "--hook session-start";

const HOOK_ARGS = "--hook session-start --tool claude-code";

/**
 * Every command shape setup itself has written, and nothing else.
 *
 * Re-running setup moves the version pin, which means rewriting a hook that is
 * already installed; this is what keeps that rewrite off a hook the user
 * edited by hand (an added flag, a wrapper script), which is left alone.
 */
function isGeneratedHookCommand(command: string): boolean {
  if (command === `node ${SELF_HOSTED_ENTRY} ${HOOK_ARGS}`) return true;
  const rest = /^npx -y xtctx(?:@\S+)? (.*)$/.exec(command);
  return rest !== null && rest[1] === HOOK_ARGS;
}

/**
 * The version a hook command is pinned to, or null when it is not pinned (the
 * unpinned form older setups wrote, or the self-hosted `node` form).
 */
export function hookCommandPin(command: string): string | null {
  const match = /^npx -y xtctx@(\S+) /.exec(command);
  return match ? match[1] : null;
}

/** The version the project's installed Claude Code hook is pinned to, if any. */
export async function readClaudeHookPin(projectRoot: string): Promise<string | null> {
  const parsed = await readJsonIfExists(join(projectRoot, ".claude", "settings.json"));
  const groups = isRecord(parsed) && isRecord(parsed.hooks) ? parsed.hooks.SessionStart : undefined;
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    for (const hook of group.hooks) {
      if (isRecord(hook) && typeof hook.command === "string" && hook.command.includes(CLAUDE_HOOK_MARKER)) {
        const pin = hookCommandPin(hook.command);
        if (pin) return pin;
      }
    }
  }
  return null;
}

/**
 * In its own repo, run the built entry point rather than going through npx.
 * See `isSelfHostedProject`: npx there rebuilds the package mid-session and
 * deletes the file the MCP server is configured to run.
 */
async function claudeHookCommand(projectRoot: string): Promise<string> {
  // Claude Code runs hooks with cwd = project root, so the command stays
  // path-independent — no shell-quoted absolute path to get injection wrong.
  return (await isSelfHostedProject(projectRoot))
    ? `node ${SELF_HOSTED_ENTRY} ${HOOK_ARGS}`
    : `npx -y ${pinnedPackageSpec()} ${HOOK_ARGS}`;
}

/**
 * The tools an agent may call, namespaced the way Claude Code addresses them:
 * `mcp__<server>__<tool>`.
 *
 * Listed explicitly rather than as a wildcard. `mcp__xtctx__*` would silently
 * grant any tool a future version adds; naming them means a new tool is a
 * deliberate decision, taken here, in a diff someone can read. All five are
 * read-only — the MCP layer has no write path at all — which is what makes
 * pre-granting them reasonable at all.
 */
const XTCTX_TOOL_NAMES = [
  "xtctx_recent_sessions",
  "xtctx_session_detail",
  "xtctx_search_sessions",
  "xtctx_continuity_status",
  "xtctx_handoff_manifest",
] as const;

/**
 * Claude Code addresses an MCP tool as `mcp__<server>__<tool>`, and the same
 * xtctx server reaches a project under two names: `xtctx` when `.mcp.json`
 * registers it, and `plugin:xtctx:xtctx` (written `plugin_xtctx_xtctx`) when
 * the plugin does. Both are granted. Observed live: with the plugin installed
 * the agent called the plugin's copy of the tools after setup, and an
 * allowlist naming only the project server's copy would have left every one
 * of those calls to a prompt — or, non-interactively, to a silent refusal.
 */
const CLAUDE_TOOL_PERMISSIONS = XTCTX_TOOL_NAMES.flatMap((tool) => [
  `mcp__xtctx__${tool}`,
  `mcp__plugin_xtctx_xtctx__${tool}`,
]);

export interface ClaudeHookResult {
  /** Whether anything was written. */
  changed: boolean;
  /**
   * Why the hook could not be installed, when it could not be.
   *
   * Setup collects these into its `failures` list and exits nonzero. A
   * refusal has to be reported rather than returned as "no change": the hook
   * is what puts handoff in front of the agent without it asking, so silently
   * not installing it looks exactly like a working setup.
   */
  failure?: string;
}

export async function installClaudeHook(projectRoot: string): Promise<ClaudeHookResult> {
  // Claude Code reads hooks from .claude/settings.json (matcher-group shape).
  // Earlier xtctx versions wrote a flat array to .claude/hooks.json, which
  // Claude Code never loads — migrate those entries out.
  const legacyChanged = await removeLegacyClaudeHook(
    join(projectRoot, ".claude", "hooks.json"),
    projectRoot,
  );

  const settingsPath = join(projectRoot, ".claude", "settings.json");
  // Read raw rather than through `readJsonIfExists`, which answers `null` for
  // a missing file and for an unparsable one alike. Treating the second as the
  // first meant a settings.json with a trailing comma was replaced by a
  // document holding nothing but xtctx's hook and permissions — the user's
  // model, env, other hooks and `permissions.deny` written away, reported as a
  // successful setup. `writeMcpConfig` already refuses in this situation; this
  // path is the one that did not.
  const raw = await readUtf8IfExists(settingsPath);
  let root: Record<string, unknown> = {};
  if (raw !== null && raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      return {
        changed: legacyChanged,
        failure:
          `Failed to parse ${settingsPath}; leaving it unchanged and skipping the ` +
          `SessionStart hook: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!isRecord(parsed)) {
      return {
        changed: legacyChanged,
        failure: `${settingsPath} is not a JSON object; leaving it unchanged and skipping the SessionStart hook.`,
      };
    }
    root = parsed;
  }

  const hooks = isRecord(root.hooks) ? root.hooks : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  const alreadyInstalled = sessionStart.some(
    (group) =>
      isRecord(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some(
        (hook) =>
          isRecord(hook) &&
          typeof hook.command === "string" &&
          hook.command.includes(CLAUDE_HOOK_MARKER),
      ),
  );

  // Not an early return on `alreadyInstalled`. Every project set up before
  // permissions existed already has the hook, so stopping here would leave
  // exactly the installs that need the fix without it.
  const command = await claudeHookCommand(projectRoot);
  if (!alreadyInstalled) {
    hooks.SessionStart = [...sessionStart, { hooks: [{ type: "command", command }] }];
    root.hooks = hooks;
  } else {
    // Re-running setup is how the version pin moves, so a hook setup wrote
    // earlier is brought up to date rather than left on the old version.
    for (const group of sessionStart) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks) {
        if (
          isRecord(hook) &&
          typeof hook.command === "string" &&
          isGeneratedHookCommand(hook.command)
        ) {
          hook.command = command;
        }
      }
    }
  }

  // Registering the server is not the same as being allowed to call it.
  // Without this every tool call is refused — a prompt the user clicks
  // through interactively, and a silent refusal everywhere else, which is
  // the automated case cross-tool handoff exists for.
  const permissions = isRecord(root.permissions) ? root.permissions : {};
  const allow = Array.isArray(permissions.allow)
    ? permissions.allow.filter((entry): entry is string => typeof entry === "string")
    : [];
  const missing = CLAUDE_TOOL_PERMISSIONS.filter((tool) => !allow.includes(tool));
  if (missing.length > 0) {
    permissions.allow = [...allow, ...missing];
    root.permissions = permissions;
  }

  const changed = await writeIfChanged(
    settingsPath,
    JSON.stringify(root, null, 2) + "\n",
    projectRoot,
  );
  return { changed: changed || legacyChanged };
}

async function removeLegacyClaudeHook(hooksPath: string, projectRoot: string): Promise<boolean> {
  const existing = await readJsonIfExists(hooksPath);
  if (!isRecord(existing) || !isRecord(existing.hooks)) {
    return false;
  }

  const hooks = existing.hooks;
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  const kept = sessionStart.filter(
    (entry) =>
      !(
        isRecord(entry) &&
        typeof entry.command === "string" &&
        entry.command.includes(CLAUDE_HOOK_MARKER)
      ),
  );
  if (kept.length === sessionStart.length) {
    return false;
  }

  const otherHookKeys = Object.keys(hooks).filter((key) => key !== "SessionStart");
  const otherRootKeys = Object.keys(existing).filter((key) => key !== "hooks");
  if (kept.length === 0 && otherHookKeys.length === 0 && otherRootKeys.length === 0) {
    // The file held nothing but the entry we wrote; remove it entirely.
    await rm(hooksPath, { force: true });
    return true;
  }

  hooks.SessionStart = kept;
  return writeIfChanged(hooksPath, JSON.stringify(existing, null, 2) + "\n", projectRoot);
}

/** Strip xtctx SessionStart matcher groups from .claude/settings.json. */
export async function removeClaudeHookFromSettings(
  settingsPath: string,
  projectRoot: string,
): Promise<boolean> {
  const raw = await readUtf8IfExists(settingsPath);
  if (raw === null) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  // Setup grants the five xtctx tools in `permissions.allow`; disconnect takes
  // exactly those back and leaves everything else. Filtering by our own list
  // rather than by prefix is what keeps a rule the user wrote by hand — or one
  // another tool added — out of the blast radius.
  let permissionsChanged = false;
  if (isRecord(parsed.permissions) && Array.isArray(parsed.permissions.allow)) {
    const allow = parsed.permissions.allow;
    const kept = allow.filter(
      (entry) => typeof entry !== "string" || !(CLAUDE_TOOL_PERMISSIONS as readonly string[]).includes(entry),
    );
    if (kept.length !== allow.length) {
      permissionsChanged = true;
      if (kept.length === 0) {
        delete parsed.permissions.allow;
        if (Object.keys(parsed.permissions).length === 0) {
          delete parsed.permissions;
        }
      } else {
        parsed.permissions.allow = kept;
      }
    }
  }

  if (!isRecord(parsed.hooks)) {
    if (permissionsChanged) {
      await writeFileAtomic(settingsPath, JSON.stringify(parsed, null, 2) + "\n", {
        containWithin: projectRoot,
      });
    }
    return permissionsChanged;
  }

  const sessionStart = Array.isArray(parsed.hooks.SessionStart) ? parsed.hooks.SessionStart : [];
  const kept = sessionStart
    .map((group) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        return group;
      }
      const hooks = group.hooks.filter(
        (hook) =>
          !isRecord(hook) ||
          typeof hook.command !== "string" ||
          !hook.command.includes(CLAUDE_HOOK_MARKER),
      );
      return hooks.length === group.hooks.length ? group : { ...group, hooks };
    })
    .filter(
      (group) => !isRecord(group) || !Array.isArray(group.hooks) || group.hooks.length > 0,
    );

  if (JSON.stringify(kept) === JSON.stringify(sessionStart) && !permissionsChanged) {
    return false;
  }

  parsed.hooks.SessionStart = kept;

  // A settings file left holding nothing but an empty SessionStart list was
  // created by setup for that hook alone; remove it rather than leave litter.
  const hooksOnly =
    Object.keys(parsed).length === 1 &&
    Object.keys(parsed.hooks).length === 1 &&
    kept.length === 0;
  if (hooksOnly) {
    await rm(settingsPath, { force: true });
    return true;
  }

  await writeFileAtomic(settingsPath, JSON.stringify(parsed, null, 2) + "\n", {
    containWithin: projectRoot,
  });
  return true;
}

/** Strip xtctx entries from the legacy flat `.claude/hooks.json`. */
export async function removeClaudeHook(hooksPath: string, projectRoot: string): Promise<boolean> {
  const raw = await readUtf8IfExists(hooksPath);
  if (raw === null) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }

  if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
    return false;
  }

  const sessionStart = Array.isArray(parsed.hooks.SessionStart) ? parsed.hooks.SessionStart : [];
  const nextSessionStart = sessionStart.filter(
    (entry) => !isRecord(entry) ||
      typeof entry.command !== "string" ||
      !entry.command.includes(CLAUDE_HOOK_MARKER),
  );

  if (nextSessionStart.length === sessionStart.length) {
    return false;
  }

  parsed.hooks.SessionStart = nextSessionStart;
  await writeFileAtomic(hooksPath, JSON.stringify(parsed, null, 2) + "\n", {
    containWithin: projectRoot,
  });
  return true;
}
