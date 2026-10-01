import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../utils/atomic-file.js";
import { projectKey, xtctxHome } from "./consent.js";

/**
 * Upload bookkeeping, per project and per account, in the user's home.
 *
 * Not in the project's index: the index is derived data that gets set aside
 * and rebuilt, and a `.xtctx/` copied into another folder would carry another
 * project's position with it. Keyed by account (user and server) so that
 * logging in as someone else uploads the project to them in full.
 */

export interface SkippedMessage {
  /** The local session_ref, "tool:sourceSessionId". */
  sessionRef: string;
  messageId: string;
  reason: string;
  at: string;
}

export interface AccountSyncState {
  /** Messages and sessions changed after this local `indexed_at`/`updated_at` are still to upload. */
  cursor?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  /** When the server was last told this project is in sync, even with nothing to send. */
  lastReportedAt?: string;
  /** Messages the server refused as too large; never sent again, and left out of the count. */
  skipped: SkippedMessage[];
}

interface ProjectSyncState {
  projectRoot: string;
  accounts: Record<string, AccountSyncState>;
}

function syncDir(): string {
  return join(xtctxHome(), "sync");
}

async function fileStem(projectRoot: string): Promise<string> {
  return createHash("sha256").update(await projectKey(projectRoot)).digest("hex").slice(0, 24);
}

export function accountKey(userId: string, syncUrl: string): string {
  return `${userId}@${syncUrl.replace(/\/+$/, "")}`;
}

async function readProjectState(projectRoot: string): Promise<ProjectSyncState> {
  try {
    const parsed = JSON.parse(await readFile(join(syncDir(), `${await fileStem(projectRoot)}.json`), "utf-8"));
    if (parsed && typeof parsed === "object" && parsed.accounts && typeof parsed.accounts === "object") {
      return parsed as ProjectSyncState;
    }
  } catch {
    // none yet, or unreadable: start clean, which at worst re-uploads (harmless)
  }
  return { projectRoot, accounts: {} };
}

export async function readAccountState(projectRoot: string, account: string): Promise<AccountSyncState> {
  const state = await readProjectState(projectRoot);
  const found = state.accounts[account];
  return { ...found, skipped: Array.isArray(found?.skipped) ? found.skipped : [] };
}

/** Every account's state for this project, for status output. */
export async function readAllAccountStates(projectRoot: string): Promise<Record<string, AccountSyncState>> {
  return (await readProjectState(projectRoot)).accounts;
}

/**
 * Change one account's state. The cursor only ever moves forward, whatever
 * the update says: two writers racing must not hand a later run an earlier
 * position (which would re-upload) or, worse, a run with stale data a later
 * one (which would skip).
 */
export async function updateAccountState(
  projectRoot: string,
  account: string,
  update: (current: AccountSyncState) => AccountSyncState,
): Promise<AccountSyncState> {
  const state = await readProjectState(projectRoot);
  const current = { ...state.accounts[account], skipped: state.accounts[account]?.skipped ?? [] };
  const next = update(current);
  if (current.cursor && (!next.cursor || next.cursor < current.cursor)) next.cursor = current.cursor;
  state.projectRoot = projectRoot;
  state.accounts[account] = next;
  await mkdir(syncDir(), { recursive: true });
  await writeFileAtomic(join(syncDir(), `${await fileStem(projectRoot)}.json`), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  return next;
}

/** A lock not touched for this long belongs to a process that died mid-upload. */
export const LOCK_STALE_MS = 10 * 60 * 1000;

export interface UploadLock {
  /** Mark the lock as still in use, during a long upload. */
  touch(): Promise<void>;
  release(): Promise<void>;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it is just not ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One uploader per project at a time, across every process on the machine.
 *
 * Every MCP server process for an opted-in project syncs on a timer, and two
 * agents open in one project means two servers. Null when another live
 * process holds the lock; a lock left by a process that is gone, or not
 * touched in LOCK_STALE_MS, is taken over.
 */
export async function acquireUploadLock(projectRoot: string): Promise<UploadLock | null> {
  await mkdir(syncDir(), { recursive: true });
  const path = join(syncDir(), `${await fileStem(projectRoot)}.lock`);
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;

  const create = async (): Promise<boolean> => {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  };

  if (!(await create())) {
    let stale = false;
    try {
      const [info, raw] = await Promise.all([stat(path), readFile(path, "utf-8")]);
      const holder = JSON.parse(raw) as { pid?: number };
      stale = Date.now() - info.mtimeMs > LOCK_STALE_MS || (typeof holder.pid === "number" && !alive(holder.pid));
    } catch {
      // Unreadable or half-written by a creator that just won: leave it; the
      // next tick looks again.
      return null;
    }
    if (!stale) return null;
    await unlink(path).catch(() => undefined);
    // Two processes taking over at once: one create wins, the other is busy.
    if (!(await create())) return null;
  }

  return {
    async touch() {
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
    },
    async release() {
      try {
        const holder = JSON.parse(await readFile(path, "utf-8")) as { token?: string };
        if (holder.token === token) await unlink(path);
      } catch {
        // already gone
      }
    },
  };
}
