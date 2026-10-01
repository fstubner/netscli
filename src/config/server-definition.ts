import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isRecord, readJsonIfExists } from "./file-io.js";
import type { McpServerDefinition } from "./mcp-renderers.js";
import { readXtctxPackage } from "../utils/package-info.js";

/**
 * Which xtctx entry point gets configured to run — the published package, or
 * this checkout's own build.
 *
 * It is one question with one answer, asked by three unrelated callers (the
 * MCP server config, the Claude Code hook command, and the managed block), so
 * it lives on its own rather than inside any of them.
 */

/** Path, relative to the project root, that this package's `bin` points at. */
export const SELF_HOSTED_ENTRY = "./dist/src/cli/index.js";

/**
 * True when the project being set up is the xtctx package itself.
 *
 * Setting xtctx up inside its own repo is the one case where `npx -y xtctx`
 * is actively wrong. npx resolves the *local* package, and installing it runs
 * `prepare` — which is `npm run build`, which begins by deleting `dist/`. The
 * SessionStart hook therefore wiped the very file the MCP server config points
 * at, and a client spawning the server in that window got "Connection closed".
 * It also meant the hook ran whatever npx had cached rather than the working
 * tree, so a developer could be debugging output no longer in their source.
 *
 * What the branch decides is which code gets configured to run: as an MCP
 * server, as a SessionStart hook command, and — through Antigravity — in a
 * *machine-global* config that outlives the project setup ran in. So the
 * question it answers is a trust question, and `package.json` cannot answer
 * it. Name and `bin` are just strings in a file, and every file in a cloned
 * repository is attacker-controlled; a hostile checkout that copied them
 * nominated its own `dist/src/cli/index.js` and xtctx wired it up.
 *
 * The authenticating step is the third check: the built entry point has to be
 * the file this process is *already executing*. That grants no new trust —
 * the operator ran this code to get here — while a checkout merely claiming
 * the name grants all of it. It also happens to be the precise condition the
 * npx problem needs, since running from `dist/` is what someone developing
 * xtctx does.
 *
 * Fails closed: anything unresolvable picks npx, which is always safe.
 */
export async function isSelfHostedProject(projectRoot: string): Promise<boolean> {
  const pkg = await readJsonIfExists(join(projectRoot, "package.json"));
  if (!isRecord(pkg) || pkg.name !== "xtctx") {
    return false;
  }
  const bin = pkg.bin;
  if (!(isRecord(bin) && typeof bin.xtctx === "string" && bin.xtctx.includes("cli/index.js"))) {
    return false;
  }

  return runningFromProject(projectRoot);
}

/**
 * True when the CLI file this process is running is the project's own built
 * entry point.
 *
 * Compared through `realpath` because the ways of invoking it differ by a
 * symlink: `node ./dist/src/cli/index.js` names it directly, while a
 * `node_modules/.bin/xtctx` shim points at the same file under another name.
 */
async function runningFromProject(projectRoot: string): Promise<boolean> {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    const [running, built] = await Promise.all([
      realpath(resolve(entry)),
      realpath(join(projectRoot, "dist", "src", "cli", "index.js")),
    ]);
    return running === built;
  } catch {
    // Either path is missing — most often a repo whose `dist/` has not been
    // built. Nothing to authenticate against, so use npx.
    return false;
  }
}

export async function xtctxServerDefinition(projectRoot?: string): Promise<McpServerDefinition> {
  if (projectRoot && (await isSelfHostedProject(projectRoot))) {
    return {
      name: "xtctx",
      // Absolute: an MCP client's cwd when it spawns a server is not
      // guaranteed to be the project root, unlike a Claude Code hook's.
      command: "node",
      args: [join(projectRoot, "dist", "src", "cli", "index.js")],
      transport: "stdio",
    };
  }

  return publishedServerDefinition();
}

/**
 * The npx package spec generated commands run: `xtctx@<version>` of whichever
 * xtctx is running setup.
 *
 * Unpinned, every agent start asks the registry what `latest` is, and the
 * SessionStart hook and the MCP server — separate processes, started
 * separately — can resolve different versions. Pinned, both run the one the
 * user set up with, and re-running setup is how the pin moves.
 *
 * The plugin's own `plugin/.mcp.json` is deliberately NOT written through this:
 * it ships inside the plugin and has to follow the plugin's version, which a
 * pin baked in by setup would fight.
 */
export function pinnedPackageSpec(version: string = readXtctxPackage(import.meta.url).version): string {
  return `xtctx@${version}`;
}

/** The package as everyone else runs it, pinned to the version running setup. */
export function publishedServerDefinition(version?: string): McpServerDefinition {
  return {
    name: "xtctx",
    command: "npx",
    args: ["-y", pinnedPackageSpec(version)],
    transport: "stdio",
  };
}
