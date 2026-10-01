import { resolve } from "node:path";
import { callCloud, loadSavedCredentials, saveCredentials } from "../sync/client.js";
import { setOptedIn } from "../sync/consent.js";
import { runDiffSync, type DiffSyncResult } from "../sync/diff-sync.js";
import { describeCloudSync } from "../sync/report.js";

const WATCH_INTERVAL_MS = 10_000;

function describe(result: DiffSyncResult): string {
  if (result.busy) return "Another xtctx process is uploading this project right now; it will pick up these changes.";
  const lines = [result.syncedCount === 0 ? "Cloud sync is up to date." : `Sent ${result.syncedCount} message(s) from ${result.sessionCount} session(s) to xtctx cloud.`];
  for (const s of result.skipped) lines.push(`Skipped message ${s.messageId} in ${s.sessionRef}: ${s.reason}.`);
  return lines.join("\n");
}

/**
 * Upload this project's changes once, or with --watch keep doing it in the
 * foreground until interrupted. Same upload as the MCP server's own.
 *
 * Exits non-zero when the upload failed (once: that run; --watch: the last
 * run before Ctrl+C). The outcome is also recorded for `xtctx sync status`.
 */
export async function runSync(options: { projectDir?: string; watch?: boolean }): Promise<void> {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  let lastError = "";

  const once = async (): Promise<boolean> => {
    try {
      const result = await runDiffSync({ projectDir });
      // Quiet when watching and there is nothing to say.
      if (!options.watch || !result.upToDate || lastError) console.log(describe(result));
      lastError = "";
      process.exitCode = 0;
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Said once per distinct failure, not every ten seconds.
      if (message !== lastError) console.error(`Cloud sync failed: ${message}`);
      lastError = message;
      process.exitCode = 1;
      return false;
    }
  };

  const ok = await once();
  if (!options.watch) return;
  if (!ok && /Not logged in|not opted in/.test(lastError)) return;

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

/** `xtctx sync enable | disable | status | device <name> | token`. */
export async function runSyncSetting(action: string, options: { projectDir?: string; value?: string }): Promise<void> {
  const projectDir = resolve(options.projectDir ?? process.cwd());

  if (action === "enable") {
    await setOptedIn(projectDir, true);
    console.log(`Cloud sync is ON for ${projectDir}.`);
    console.log("Its transcripts are uploaded to your xtctx cloud account while an agent runs xtctx here.");
    if (!(await loadSavedCredentials())) console.log("You are not logged in yet: run `xtctx login`.");
    return;
  }

  if (action === "disable") {
    await setOptedIn(projectDir, false);
    console.log(`Cloud sync is OFF for ${projectDir}. Nothing more is uploaded from it.`);
    console.log("Already-uploaded data stays until you run `xtctx logout --delete-data`.");
    return;
  }

  if (action === "status") {
    for (const [i, line] of (await describeCloudSync(projectDir)).entries()) {
      console.log(i === 0 ? `Cloud sync for ${projectDir}: ${line}` : `  ${line}`);
    }
    return;
  }

  if (action === "device") {
    const creds = await loadSavedCredentials();
    if (!creds) throw new Error("Not logged in. Run `xtctx login --device <name>` instead.");
    const name = options.value?.trim();
    if (!name) {
      console.log(`This device uploads as "${creds.deviceName}". Rename it with: xtctx sync device <name>`);
      return;
    }
    if (name.length > 64) throw new Error("A device name is at most 64 characters.");
    await saveCredentials({ ...creds, deviceName: name });
    console.log(`This device now uploads as "${name}" (from its next upload).`);
    return;
  }

  if (action === "token") {
    const creds = await loadSavedCredentials();
    if (!creds) throw new Error("Not logged in. Run `xtctx login` first.");
    const res = await callCloud(creds, "POST", "/api/tokens");
    if (res.status === 401) throw new Error("Your xtctx cloud login is no longer valid. Run `xtctx login`.");
    if (!res.ok) throw new Error(`Could not create a token (server answered ${res.status}).`);
    const body = (await res.json()) as { token: string; mcp_url: string; expires_at: string };
    console.error(
      `A read-only token for ${body.mcp_url}, valid until ${body.expires_at}. It can read every transcript in your account;\n` +
        "keep it out of files you commit. `xtctx logout` revokes it. Prefer the client's own sign-in where it has one.",
    );
    console.log(body.token);
    return;
  }

  console.error(`Unknown action "${action}". Use enable, disable, status, device or token, or no action to upload once.`);
  process.exitCode = 1;
}
