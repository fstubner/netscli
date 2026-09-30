import { exec } from "node:child_process";
import { promisify } from "node:util";
import { relative, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

/**
 * Extract canonical git repository identifier (e.g. "github.com/fstubner/xtctx").
 * Falls back to stable .xtctx/project.id UUID if untracked by git.
 */
export async function getCanonicalRepoId(projectDir: string): Promise<{ repoId: string; repoRoot: string }> {
  try {
    const { stdout: rootStdout } = await execAsync("git rev-parse --show-toplevel", { cwd: projectDir });
    const repoRoot = rootStdout.trim();

    const { stdout: originStdout } = await execAsync("git config --get remote.origin.url", { cwd: repoRoot });
    const rawOrigin = originStdout.trim();

    if (rawOrigin) {
      // Normalize ssh and https URLs to clean identifier:
      // "git@github.com:user/repo.git" -> "github.com/user/repo"
      // "https://github.com/user/repo.git" -> "github.com/user/repo"
      let cleaned = rawOrigin
        .replace(/\.git$/i, "")
        .replace(/^git@([^:]+):/, "$1/")
        .replace(/^https?:\/\//, "");

      return { repoId: cleaned, repoRoot };
    }
    
    // In git repo without remote origin, use root directory basename + commit or branch
    const { stdout: branchStdout } = await execAsync("git branch --show-current", { cwd: repoRoot });
    return { repoId: `local-git:${repoRoot.replace(/[\\/]/g, "-")}`, repoRoot };
  } catch {
    // Non-git folder fallback: use or create .xtctx/project.id
    const xtctxDir = join(projectDir, ".xtctx");
    const idFile = join(xtctxDir, "project.id");
    if (existsSync(idFile)) {
      const id = (await readFile(idFile, "utf-8")).trim();
      return { repoId: `untracked:${id}`, repoRoot: projectDir };
    }

    const newId = randomUUID();
    try {
      await writeFile(idFile, newId, "utf-8");
    } catch {
      // Ignore write errors
    }
    return { repoId: `untracked:${newId}`, repoRoot: projectDir };
  }
}

/**
 * Convert an absolute file path into a POSIX repository-relative path.
 */
export function toRepoRelativePath(absolutePath: string, repoRoot: string): string {
  const rel = relative(repoRoot, resolve(absolutePath));
  return rel.replace(/\\/g, "/");
}
