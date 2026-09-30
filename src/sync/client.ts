import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

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

const DEFAULT_SYNC_URL = "https://sync.xtctx.com";

export function getCredentialsPath(): string {
  return join(homedir(), ".xtctx", "credentials.json");
}

export async function loadCredentials(): Promise<SyncCredentials | null> {
  const credPath = getCredentialsPath();
  if (process.env.XTCTX_TOKEN) {
    return {
      token: process.env.XTCTX_TOKEN,
      user: { id: "env-user", username: "developer" },
      deviceId: "env-device",
      deviceName: "cli-env",
      syncUrl: process.env.XTCTX_SYNC_URL || DEFAULT_SYNC_URL,
    };
  }

  if (!existsSync(credPath)) {
    return null;
  }

  try {
    const raw = await readFile(credPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: SyncCredentials): Promise<void> {
  const credPath = getCredentialsPath();
  const dir = join(homedir(), ".xtctx");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(credPath, JSON.stringify(creds, null, 2), "utf-8");
}

/**
 * Stream a turn delta to the Cloudflare Worker backend.
 */
export async function pushTurnDelta(
  creds: SyncCredentials,
  delta: Record<string, unknown>
): Promise<{ success: boolean; sessionRef?: string }> {
  const url = `${creds.syncUrl.replace(/\/$/, "")}/api/stream`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...delta,
      deviceId: creds.deviceId,
      deviceName: creds.deviceName,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Sync failed (${res.status}): ${errText}`);
  }

  return (await res.json()) as { success: boolean; sessionRef?: string };
}
