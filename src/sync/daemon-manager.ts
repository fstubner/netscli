import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, openSync, closeSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { loadCredentials } from "./client.js";

function getXtctxDir(): string {
  return join(homedir(), ".xtctx");
}

function getPidPath(): string {
  return join(getXtctxDir(), "daemon.pid");
}

export function getDaemonLogPath(): string {
  return join(getXtctxDir(), "daemon.log");
}

/**
 * Check if the daemon process with the given PID is currently active.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current status of the background sync daemon.
 */
export async function getDaemonStatus(): Promise<{ running: boolean; pid?: number; logPath: string }> {
  const pidPath = getPidPath();
  const logPath = getDaemonLogPath();

  if (!existsSync(pidPath)) {
    return { running: false, logPath };
  }

  try {
    const rawPid = await readFile(pidPath, "utf-8");
    const pid = parseInt(rawPid.trim(), 10);

    if (isNaN(pid) || !isProcessAlive(pid)) {
      // Stale PID file, clean it up
      await unlink(pidPath).catch(() => {});
      return { running: false, logPath };
    }

    return { running: true, pid, logPath };
  } catch {
    return { running: false, logPath };
  }
}

/**
 * Stop the running background sync daemon.
 */
export async function stopDaemon(): Promise<boolean> {
  const status = await getDaemonStatus();
  if (!status.running || !status.pid) {
    return false;
  }

  try {
    if (process.platform === "win32") {
      // On Windows, taskkill cleanly kills process tree
      const { exec } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        exec(`taskkill /pid ${status.pid} /T /F`, () => resolve());
      });
    } else {
      process.kill(status.pid, "SIGTERM");
    }
  } catch {
    // Ignore error if process already exited
  }

  await unlink(getPidPath()).catch(() => {});
  return true;
}

/**
 * Ensure the background sync daemon is running if the user is authenticated.
 * Spawns a detached background process if it is not running.
 */
export async function ensureDaemonRunning(cliPath?: string): Promise<{ started: boolean; pid?: number }> {
  // Only auto-spawn if authenticated
  const creds = await loadCredentials();
  if (!creds) {
    return { started: false };
  }

  const status = await getDaemonStatus();
  if (status.running && status.pid) {
    return { started: false, pid: status.pid };
  }

  const xtctxDir = getXtctxDir();
  if (!existsSync(xtctxDir)) {
    await mkdir(xtctxDir, { recursive: true });
  }

  const logPath = getDaemonLogPath();
  const logFd = openSync(logPath, "a");

  const entrypoint = cliPath || process.argv[1] || resolve(import.meta.dirname, "../cli/index.js");

  const child = spawn(process.execPath, [entrypoint, "watch"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });

  child.unref();

  // Close parent's handle to logfile
  try {
    closeSync(logFd);
  } catch {
    // Ignore
  }

  if (child.pid) {
    await writeFile(getPidPath(), String(child.pid), "utf-8");
    return { started: true, pid: child.pid };
  }

  return { started: false };
}
