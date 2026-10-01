import { NotLoggedInError, NotOptedInError, runDiffSync, type DiffSyncResult } from "./diff-sync.js";

export interface AutoSync {
  /** Stop the timer, let a sync in flight finish, then upload once more. */
  stop(): Promise<void>;
}

export interface AutoSyncOptions {
  projectRoot: string;
  log: (line: string) => void;
  intervalMs?: number;
  /** How long the final upload on shutdown may take before it is abandoned. */
  flushTimeoutMs?: number;
  sync?: (options: { projectDir: string }) => Promise<DiffSyncResult>;
}

/**
 * Keep an opted-in project's uploads current while the MCP server runs.
 *
 * Transcripts only change while an agent is running, and an agent with xtctx
 * wired runs this server for the whole session, so syncing from here is as
 * fresh as a separate daemon was without leaving a process behind. A crash
 * loses at most the last interval, which the next start uploads.
 *
 * Each tick asks `runDiffSync`, which refuses unless someone is logged in and
 * the project is opted in, so a project that is neither costs two small file
 * reads per tick and sends nothing. Ticks never overlap: the next is
 * scheduled when the previous one finishes. Across processes (two agents
 * open in one project each run a server) a lock in ~/.xtctx lets one upload
 * at a time; the others find it busy and wait for their next tick.
 */
export function startAutoSync(options: AutoSyncOptions): AutoSync {
  const { projectRoot, log } = options;
  const intervalMs = options.intervalMs ?? 10_000;
  const flushTimeoutMs = options.flushTimeoutMs ?? 1_500;
  const sync = options.sync ?? runDiffSync;

  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;
  let lastError = "";

  const tick = async (): Promise<void> => {
    try {
      const result = await sync({ projectDir: projectRoot });
      if (result.busy) return; // another process is uploading this project
      if (result.syncedCount > 0) log(`xtctx: sent ${result.syncedCount} message(s) to xtctx cloud`);
      for (const s of result.skipped) {
        log(`xtctx: cloud sync skipped message ${s.messageId} in ${s.sessionRef}: ${s.reason}`);
      }
      lastError = "";
    } catch (err) {
      if (err instanceof NotLoggedInError || err instanceof NotOptedInError) return;
      // Said once per distinct failure, not every ten seconds. The failure is
      // also recorded for `xtctx sync status`.
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastError) log(`xtctx: cloud sync failed: ${message}`);
      lastError = message;
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = tick().then(schedule);
    }, intervalMs);
    timer.unref?.();
  };
  schedule();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
      let abandon: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>((resolve) => {
        abandon = setTimeout(resolve, flushTimeoutMs);
      });
      await Promise.race([tick(), deadline]);
      clearTimeout(abandon);
    },
  };
}
