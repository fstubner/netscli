import { realpath, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../utils/atomic-file.js";

/** Where xtctx keeps what belongs to the user rather than to one project. */
export function xtctxHome(): string {
  return join(homedir(), ".xtctx");
}

function consentPath(): string {
  return join(xtctxHome(), "cloud-projects.json");
}

/**
 * Which projects may upload to xtctx cloud.
 *
 * A list in the user's home, not a setting in the project: `.xtctx/config.yaml`
 * is the file a repository can commit, and a clone must not be able to opt
 * its reader in to sending their transcripts anywhere. Logging in does not
 * add to it either; the two are separate decisions.
 */
export async function projectKey(projectRoot: string): Promise<string> {
  const real = await realpath(projectRoot).catch(() => projectRoot);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

async function readList(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(consentPath(), "utf-8")) as { projects?: unknown };
    return Array.isArray(parsed.projects) ? parsed.projects.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

async function writeList(projects: string[]): Promise<void> {
  await writeFileAtomic(consentPath(), JSON.stringify({ projects }, null, 2), { mode: 0o600 });
}

export async function isOptedIn(projectRoot: string): Promise<boolean> {
  return (await readList()).includes(await projectKey(projectRoot));
}

export async function setOptedIn(projectRoot: string, optedIn: boolean): Promise<void> {
  const key = await projectKey(projectRoot);
  const rest = (await readList()).filter((p) => p !== key);
  await writeList(optedIn ? [...rest, key] : rest);
}
