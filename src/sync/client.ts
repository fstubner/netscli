import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "../utils/atomic-file.js";
import { readXtctxPackage } from "../utils/package-info.js";
import { xtctxHome } from "./consent.js";

export interface SyncCredentials {
  token: string;
  user: {
    id: string;
    username: string;
    name?: string;
  };
  deviceId: string;
  deviceName: string;
  syncUrl: string;
}

export const DEFAULT_SYNC_URL = "https://sync.xtctx.com";

export function getCredentialsPath(): string {
  return join(xtctxHome(), "credentials.json");
}

/**
 * A name for this device that says nothing about it. The hostname used to be
 * the default, and it often carries a person's name or an employer's asset
 * tag; `xtctx login --device <name>` or `xtctx sync device <name>` sets one.
 */
export function randomDeviceName(): string {
  return `device-${randomBytes(3).toString("hex")}`;
}

/** The saved login from `xtctx login`, or null. */
export async function loadSavedCredentials(): Promise<SyncCredentials | null> {
  try {
    return JSON.parse(await readFile(getCredentialsPath(), "utf-8")) as SyncCredentials;
  } catch {
    return null;
  }
}

/** Credentials described by XTCTX_TOKEN / XTCTX_SYNC_URL, or null when neither is set. */
function credentialsFromEnv(saved: SyncCredentials | null): SyncCredentials | null {
  const envToken = process.env.XTCTX_TOKEN || undefined;
  const envUrl = process.env.XTCTX_SYNC_URL || undefined;
  if (!envToken && !envUrl) return null;
  if (!envToken) return saved ? { ...saved, syncUrl: envUrl! } : null;

  let userId = "env-user";
  let username = "developer";
  try {
    const payload = JSON.parse(Buffer.from(envToken.split(".")[1] ?? "", "base64url").toString("utf-8"));
    if (typeof payload.sub === "string") userId = payload.sub;
    if (typeof payload.username === "string") username = payload.username;
  } catch {
    // Not a decodable JWT; the server is what judges the token.
  }
  // Stable across runs without saying anything about the machine.
  const stableId = `device-${createHash("sha256").update(hostname()).digest("hex").slice(0, 12)}`;
  return {
    token: envToken,
    user: { id: userId, username },
    deviceId: process.env.XTCTX_DEVICE_ID || saved?.deviceId || stableId,
    deviceName: process.env.XTCTX_DEVICE_NAME || saved?.deviceName || stableId,
    syncUrl: envUrl || saved?.syncUrl || DEFAULT_SYNC_URL,
  };
}

/**
 * The login in effect: XTCTX_TOKEN / XTCTX_SYNC_URL when set, otherwise the
 * saved one. For showing who is logged in; uploads go through
 * `resolveUploadCredentials`, which is stricter about the environment.
 */
export async function loadCredentials(): Promise<SyncCredentials | null> {
  const saved = await loadSavedCredentials();
  return credentialsFromEnv(saved) ?? saved;
}

export class EnvCredentialsRefusedError extends Error {
  constructor() {
    super(
      "XTCTX_TOKEN or XTCTX_SYNC_URL is set and differs from your saved login, so this project's uploads " +
        "would go to another account or server than the one you signed in to. Refusing to upload. " +
        "Unset them, or set XTCTX_ALLOW_ENV_CREDENTIALS=1 if that is what you want.",
    );
    this.name = "EnvCredentialsRefusedError";
  }
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/**
 * The credentials an upload may use.
 *
 * Environment variables reach a process from places the user does not see,
 * such as an MCP config's `env` block, which a repository can ship. One that
 * sets XTCTX_TOKEN or XTCTX_SYNC_URL could otherwise send an opted-in
 * project's transcripts to someone else's account or server. So when they
 * name anything other than the saved login (including when there is no saved
 * login), uploading also needs XTCTX_ALLOW_ENV_CREDENTIALS=1. Null when there
 * is no login at all.
 */
export async function resolveUploadCredentials(): Promise<SyncCredentials | null> {
  const saved = await loadSavedCredentials();
  const fromEnv = credentialsFromEnv(saved);
  if (!fromEnv) return saved;
  const matchesSaved = saved !== null && fromEnv.token === saved.token && sameUrl(fromEnv.syncUrl, saved.syncUrl);
  if (!matchesSaved && process.env.XTCTX_ALLOW_ENV_CREDENTIALS !== "1") throw new EnvCredentialsRefusedError();
  return fromEnv;
}

/** Written 0600 and atomically: it holds a bearer token. */
export async function saveCredentials(creds: SyncCredentials): Promise<void> {
  await writeFileAtomic(getCredentialsPath(), JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export async function deleteCredentials(): Promise<void> {
  await rm(getCredentialsPath(), { force: true });
}

/**
 * A token must not travel in the clear. Plain http is for a server on this
 * machine, which is what development uses.
 */
export function assertSecureSyncUrl(syncUrl: string): void {
  const url = new URL(syncUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`Refusing ${syncUrl}: the sync server must be https (http is allowed only for localhost).`);
  }
}

/**
 * Every cloud request closes its connection when it is done.
 *
 * On Windows, Node 24.14 aborts with `Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)` (exit 0xC0000409) when `process.exit` runs while fetch
 * still holds a pooled keep-alive socket after a POST. The MCP server does
 * exactly that: an upload tick, then the final upload on shutdown, then exit.
 * It crashed in 10 of 10 such runs; with this header, 0 of 8 in a standalone
 * reproduction. Uploads are seconds apart, so reusing the connection saves
 * nothing worth the crash.
 */
export const NO_KEEP_ALIVE = { Connection: "close" } as const;

/** Sent on every request, so the server can tell which client versions are out there. */
export function clientHeader(): string {
  return `xtctx/${readXtctxPackage(import.meta.url).version}`;
}

export async function callCloud(
  creds: SyncCredentials,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  assertSecureSyncUrl(creds.syncUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    "X-Xtctx-Client": clientHeader(),
    ...NO_KEEP_ALIVE,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${creds.syncUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
