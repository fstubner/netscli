import { randomBytes } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

interface WriteFileAtomicOptions {
  /** File mode for a secret, e.g. 0o600. Ignored on Windows, which has no such bits. */
  mode?: number;
  /**
   * Directory the write must stay inside, after symlinks are resolved.
   *
   * Symlinks are not refused outright: pointing `~/.claude` at a dotfiles
   * repo is a common and legitimate setup. What is refused is a write that
   * *escapes* the root it belongs to — a cloned repo committing `.claude` as
   * a symlink to somewhere else, so that `xtctx setup` writes through it.
   * That matters because some targets are executable surfaces:
   * `.claude/settings.json` holds hook commands Claude Code runs.
   */
  containWithin?: string;
}

/** True when `candidate` is `root` itself or sits underneath it. */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolve `target` through any symlinks, tolerating the leading segments that
 * do not exist yet. `realpath` fails on a missing path, so walk up to the
 * deepest ancestor that does exist, resolve that, and re-append the rest —
 * which is what makes the check work on a clean checkout where the whole
 * `.claude/skills/<id>/` subtree is about to be created.
 */
async function resolveDeepest(target: string): Promise<string> {
  const absolute = resolve(target);
  let existing = absolute;
  const pending: string[] = [];

  for (;;) {
    try {
      return resolve(await realpath(existing), ...pending.reverse());
    } catch {
      const parent = dirname(existing);
      // Hit the filesystem root without finding anything that exists.
      if (parent === existing) return absolute;
      pending.push(existing.slice(parent.length + 1));
      existing = parent;
    }
  }
}

async function assertContained(filePath: string, containWithin: string): Promise<void> {
  const root = await resolveDeepest(containWithin);
  const target = await resolveDeepest(filePath);

  if (!isInside(root, target)) {
    throw new Error(
      `Refusing to write outside ${containWithin}: ${filePath} resolves to ${target}. ` +
        "A symlinked config directory can redirect writes out of the project.",
    );
  }
}

/**
 * Write via a temp file + rename so an interrupted setup never leaves a
 * truncated config file behind — these writes target files owned by other
 * tools (.mcp.json, config.toml, CLAUDE.md, …), where a partial write is a
 * corruption the owning tool has to recover from.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options: WriteFileAtomicOptions = {},
): Promise<void> {
  if (options.containWithin) {
    // Before mkdir: `mkdir -p` follows a symlinked directory and builds the
    // rest of the subtree on the far side, so checking afterwards would be
    // checking a path the escape had already created.
    await assertContained(filePath, options.containWithin);
  }

  await mkdir(dirname(filePath), { recursive: true });

  if (options.containWithin) {
    // Re-check: mkdir may have followed a link that only became reachable
    // once the intermediate directories existed.
    await assertContained(filePath, options.containWithin);
  }

  // Random suffix, and `wx` so the open fails rather than following a
  // symlink someone pre-created at a guessable temp path.
  const tmpPath = `${filePath}.${randomBytes(6).toString("hex")}.xtctx-tmp`;
  await writeFile(tmpPath, content, { encoding: "utf-8", flag: "wx", mode: options.mode });
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
