import { hostname } from "node:os";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "../utils/atomic-file.js";
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
 * The saved login, or one built from XTCTX_TOKEN for a machine nobody logs in
 * on. Having credentials does not mean anything is uploaded: that also needs
 * the project to be opted in (see consent.ts).
 */
export async function loadCredentials(): Promise<SyncCredentials | null> {
  if (process.env.XTCTX_TOKEN) {
    const token = process.env.XTCTX_TOKEN;
    let userId = "env-user";
    let username = "developer";
    let deviceId = process.env.XTCTX_DEVICE_ID;

    try {
      const parts = token.split(".");
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
        if (payload.sub) userId = payload.sub;
        if (payload.username) username = payload.username;
        if (payload.device_id && !deviceId) deviceId = payload.device_id;
      }
    } catch {
      // Not a decodable JWT; the server is what judges the token.
    }

    const machineName = hostname();
    return {
      token,
      user: { id: userId, username },
      deviceId: deviceId || `device-${machineName.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`,
      deviceName: process.env.XTCTX_DEVICE_NAME || machineName,
      syncUrl: process.env.XTCTX_SYNC_URL || DEFAULT_SYNC_URL,
    };
  }

  try {
    return JSON.parse(await readFile(getCredentialsPath(), "utf-8")) as SyncCredentials;
  } catch {
    return null;
  }
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

export async function callCloud(creds: SyncCredentials, method: string, path: string): Promise<Response> {
  assertSecureSyncUrl(creds.syncUrl);
  return fetch(`${creds.syncUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${creds.token}` },
  });
}
