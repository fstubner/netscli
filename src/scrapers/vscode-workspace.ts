import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathMatchesProject } from "../utils/project-scope.js";

/**
 * Whether a VS Code workspace belongs to this project.
 *
 * Cursor and GitHub Copilot both store their history under VS Code's
 * `workspaceStorage` layout: a directory per workspace holding a
 * `state.vscdb` beside a `workspace.json` naming the folder it was opened on.
 * That file is the only evidence of which project a workspace belongs to, so
 * this is the filter that keeps one project's conversations out of another's
 * answers — for two scrapers, from one place.
 *
 * It was two places. The function was byte-identical in `cursor.ts` and
 * `copilot/scraper.ts` with nothing in either saying a second copy existed,
 * which for a boundary check means a fix or a hardening could land on one
 * scraper and silently not the other.
 *
 * Fails closed throughout: an unreadable or malformed `workspace.json`, or one
 * naming no folder, is not evidence that the workspace is ours.
 */
export async function workspaceMatchesProject(
  workspaceDbPath: string,
  projectRoot: string,
): Promise<boolean> {
  return (await classifyWorkspace(workspaceDbPath, projectRoot)) === "match";
}

/**
 * Whose a workspace is, for a caller that has to tell "not this project" from
 * "cannot tell".
 *
 * `workspaceMatchesProject` folds both into `false`, which is right for a
 * filter and wrong for Cursor's conversation headers: a header names a
 * workspace, and a workspace that is plainly another project's settles the
 * conversation, while one whose `workspace.json` is gone or names no folder
 * (a multi-root workspace) settles nothing and leaves it to be placed by the
 * files it recorded.
 *
 * - `match`: the folder is this project.
 * - `other`: a folder is recorded and it is not this project — including a
 *   remote folder this machine cannot be the owner of.
 * - `unknown`: no usable folder to compare, which is not evidence either way.
 */
export type WorkspaceOwnership = "match" | "other" | "unknown";

export async function classifyWorkspace(
  workspaceDbPath: string,
  projectRoot: string,
): Promise<WorkspaceOwnership> {
  try {
    const raw = await readFile(join(dirname(workspaceDbPath), "workspace.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const folder = typeof parsed.folder === "string" ? parsed.folder : undefined;
    if (!folder) {
      return "unknown";
    }
    const folderPath = folder.startsWith("file:") ? fileURLToPath(folder) : folder;
    if (pathMatchesProject(folderPath, projectRoot)) {
      return "match";
    }

    // A `vscode-remote://` folder is a URI, not a path, so the comparison
    // above never matches one — not even when xtctx runs inside the same WSL
    // distro and the root is literally the path the URI carries. Both readings
    // of a WSL folder are offered here instead.
    for (const candidate of wslWorkspacePaths(folder)) {
      if (pathMatchesProject(candidate, projectRoot)) {
        return "match";
      }
    }

    return "other";
  } catch {
    return "unknown";
  }
}

/**
 * Every path a WSL workspace URI could name, for whichever side xtctx runs on.
 *
 * VS Code and Cursor record a folder opened through WSL as
 * `vscode-remote://wsl%2B<distro>/mnt/h/projects/app`, never as a `file:` URL.
 * Nothing decoded that, and a URI compared against a path never matches, so
 * those workspaces were invisible — with no drift warning and no empty result,
 * because a workspace that does not match is indistinguishable from one
 * belonging to another project.
 *
 * Two readings, because the same URI means two things depending on where this
 * process is running:
 *
 * - The POSIX path itself, for xtctx running inside that distro, where the
 *   project root *is* `/mnt/h/projects/app`. This never matched either: the
 *   comparison saw the whole URI, scheme and authority included.
 * - Its Windows equivalent, for xtctx running on the host. `/mnt/<drive>` is
 *   WSL's documented default automount root, confirmed on the machine this was
 *   measured on: no `[automount]` section in `/etc/wsl.conf`, and `H:\ on
 *   /mnt/h` in the live mount table.
 *
 * Nothing is offered for:
 *
 * - Any authority that is not `wsl+`. `ssh-remote`, `dev-container` and
 *   `codespaces` name other machines — that store held 9 such workspaces for
 *   Cursor and 5 for VS Code — and mapping one onto a local root would serve a
 *   different computer's conversations as this project's.
 * - The bare `/<drive>/…` shape left by an `automount root = /` configuration.
 *   It appears 17 times in each tool's store here and every one of those
 *   workspaces holds zero conversations, so translating it would add this
 *   design's only ambiguity — a single-letter Linux directory that looks like
 *   a drive letter — in exchange for nothing. The POSIX reading above still
 *   covers it for anyone running inside WSL.
 */
function* wslWorkspacePaths(folder: string): Iterable<string> {
  const parts = /^vscode-remote:\/\/([^/]+)(\/.*)$/.exec(folder);
  if (!parts) {
    return;
  }

  if (!decodeMaybe(parts[1]).startsWith("wsl+")) {
    return;
  }

  const posixPath = decodeMaybe(parts[2]);
  yield posixPath;

  const mount = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(posixPath);
  if (!mount) {
    return;
  }

  const rest = mount[2] ?? "";
  yield `${mount[1].toUpperCase()}:${rest === "" ? "\\" : rest.replace(/\//g, "\\")}`;
}

/** Percent-decoding that leaves a malformed sequence as it found it. */
function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
