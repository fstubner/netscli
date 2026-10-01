import { exec } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";

const execAsync = promisify(exec);

/**
 * Identify a project for the cloud: the normalised git remote when there is
 * one ("github.com/fstubner/xtctx"), otherwise a hash of where it lives.
 *
 * Nothing is written into the project for this. An earlier version minted a
 * `.xtctx/project.id` file in any folder that was not a git repository, which
 * is a change to the user's tree made by an upload feature.
 */
export async function getCanonicalRepoId(projectDir: string): Promise<{ repoId: string; repoRoot: string }> {
  try {
    const { stdout: rootStdout } = await execAsync("git rev-parse --show-toplevel", { cwd: projectDir });
    const repoRoot = rootStdout.trim();
    const { stdout: originStdout } = await execAsync("git config --get remote.origin.url", { cwd: repoRoot });
    const origin = originStdout.trim();
    if (origin) return { repoId: normalizeRemote(origin), repoRoot };
    return { repoId: await pathId(repoRoot), repoRoot };
  } catch {
    // Not a git repository, or one with no origin.
    return { repoId: await pathId(projectDir), repoRoot: projectDir };
  }
}

/**
 * "git@github.com:user/repo.git" and "https://github.com/user/repo.git" both
 * become "github.com/user/repo". Credentials in a URL are dropped.
 */
export function normalizeRemote(remote: string): string {
  return remote
    .replace(/\.git$/i, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "");
}

async function pathId(dir: string): Promise<string> {
  const real = await realpath(dir).catch(() => dir);
  return `local:${createHash("sha256").update(real).digest("hex").slice(0, 16)}`;
}
