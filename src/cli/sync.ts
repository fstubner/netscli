import { resolve } from "node:path";
import { loadCredentials } from "../sync/client.js";
import { isOptedIn, setOptedIn } from "../sync/consent.js";
import { NotLoggedInError, NotOptedInError, runDiffSync } from "../sync/diff-sync.js";

const WATCH_INTERVAL_MS = 10_000;

/**
 * Upload this project's new turns once, or with --watch keep doing it in the
 * foreground until interrupted. Same upload as the MCP server's own, so there
 * is nothing here that runs unless you ran it.
 */
export async function runSync(options: { projectDir?: string; watch?: boolean }): Promise<void> {
  const projectDir = resolve(options.projectDir ?? process.cwd());

  const once = async (): Promise<boolean> => {
    try {
      const result = await runDiffSync({ projectDir });
      console.log(result.upToDate ? "Cloud sync is up to date." : `Synced ${result.syncedCount} turns to cloud.`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NotLoggedInError || err instanceof NotOptedInError) {
        console.error(message);
        process.exitCode = 1;
        return false;
      }
      console.error(`Cloud sync failed: ${message}`);
      return true; // keep going when watching; the next pass retries
    }
  };

  if (!(await once()) || !options.watch) return;

  console.log(`Watching ${projectDir}; uploading every ${WATCH_INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
  await new Promise<void>((done) => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void once().finally(() => {
        busy = false;
      });
    }, WATCH_INTERVAL_MS);
    process.once("SIGINT", () => {
      clearInterval(timer);
      done();
    });
  });
}

/** `xtctx sync enable | disable | status`: the per-project upload decision. */
export async function runSyncSetting(action: string, options: { projectDir?: string }): Promise<void> {
  const projectDir = resolve(options.projectDir ?? process.cwd());

  if (action === "enable") {
    await setOptedIn(projectDir, true);
    console.log(`Cloud sync is ON for ${projectDir}.`);
    console.log("Its transcripts are uploaded to your xtctx cloud account while an agent runs xtctx here.");
    if (!(await loadCredentials())) console.log("You are not logged in yet: run `xtctx login`.");
    return;
  }

  if (action === "disable") {
    await setOptedIn(projectDir, false);
    console.log(`Cloud sync is OFF for ${projectDir}. Nothing more is uploaded from it.`);
    console.log("Already-uploaded data stays until you run `xtctx logout --delete-data`.");
    return;
  }

  if (action === "status") {
    const creds = await loadCredentials();
    console.log(creds ? `Logged in as ${creds.user.username} (${creds.syncUrl})` : "Not logged in.");
    console.log(`This project: cloud sync ${(await isOptedIn(projectDir)) ? "ON" : "OFF"}`);
    return;
  }

  console.error(`Unknown action "${action}". Use enable, disable or status, or no action to upload once.`);
  process.exitCode = 1;
}
