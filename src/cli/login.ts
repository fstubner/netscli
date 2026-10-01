import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SYNC_URL,
  assertSecureSyncUrl,
  callCloud,
  deleteCredentials,
  getCredentialsPath,
  loadCredentials,
  saveCredentials,
} from "../sync/client.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface PollResponse {
  token?: string;
  user?: { id: string; username: string; name?: string };
  error?: string;
  interval?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sign in with GitHub's device flow. Signing in is only that: it stores a
 * token. Nothing is uploaded until a project is opted in with
 * `xtctx sync enable`.
 */
export async function runLogin(options: {
  syncUrl?: string;
  deviceName?: string;
  /** Test seam; the real flow waits as long as GitHub says. */
  wait?: (ms: number) => Promise<unknown>;
}): Promise<void> {
  const syncUrl = options.syncUrl || process.env.XTCTX_SYNC_URL || DEFAULT_SYNC_URL;
  const deviceName = options.deviceName || hostname() || "default-device";
  const wait = options.wait ?? sleep;
  const base = syncUrl.replace(/\/$/, "");

  assertSecureSyncUrl(syncUrl);

  const codeRes = await fetch(`${base}/auth/device/code`, { method: "POST" });
  if (!codeRes.ok) {
    throw new Error(`Could not start login (${codeRes.status}).`);
  }
  const code = (await codeRes.json()) as DeviceCodeResponse;

  console.log(`\n  1. Copy your one-time code:  ${code.user_code}`);
  console.log(`  2. Open in your browser:     ${code.verification_uri}\n`);
  console.log("Waiting for authorization in the browser...");

  // GitHub says how long the code lives and how often to ask; ignoring either
  // gets the client rate-limited or leaves it waiting on a code that is dead.
  const deadline = Date.now() + (code.expires_in || 900) * 1000;
  let intervalMs = (code.interval || 5) * 1000;

  while (Date.now() < deadline) {
    await wait(intervalMs);

    let poll: PollResponse;
    try {
      const res = await fetch(`${base}/auth/device/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: code.device_code, device_name: deviceName }),
      });
      poll = (await res.json()) as PollResponse;
    } catch {
      continue; // a network blip; the deadline bounds how long this goes on
    }

    if (poll.token && poll.user) {
      await saveCredentials({
        token: poll.token,
        user: poll.user,
        deviceId: `dev_${randomUUID()}`,
        deviceName,
        syncUrl,
      });
      console.log(`\nLogged in as ${poll.user.username}. Saved to ${getCredentialsPath()}.`);
      console.log("Nothing is uploaded yet. To upload a project's transcripts, run in it:  xtctx sync enable");
      return;
    }

    if (poll.error === "slow_down") {
      intervalMs = poll.interval ? poll.interval * 1000 : intervalMs + 5000;
    } else if (poll.error && poll.error !== "authorization_pending") {
      throw new Error(`Login failed: ${poll.error}`);
    }
  }
  throw new Error("The login code expired before it was authorized. Run `xtctx login` again.");
}

/**
 * Sign out: ask the server to revoke this account's tokens, then forget ours.
 * With deleteData it first deletes everything the account has uploaded, and
 * keeps the local login if that fails so it can be retried.
 */
export async function runLogout(options: { deleteData?: boolean }): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.log("Not logged in.");
    return;
  }

  try {
    const res = options.deleteData
      ? await callCloud(creds, "DELETE", "/api/me")
      : await callCloud(creds, "POST", "/auth/logout");
    // 401 means the server already refuses this token, which is the state we want.
    if (!res.ok && res.status !== 401) throw new Error(`server answered ${res.status}`);
    if (options.deleteData) console.log("Deleted everything xtctx cloud held for your account.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.deleteData) {
      throw new Error(`Could not delete your cloud data (${message}). You are still logged in; try again.`);
    }
    console.warn(`Could not reach the server to revoke your token (${message}). It stays valid until it expires.`);
  }

  await deleteCredentials();
  console.log("Logged out.");
}
