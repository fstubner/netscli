import { hostname } from "node:os";
import { saveCredentials } from "../sync/client.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function runLogin(options: { syncUrl?: string; deviceName?: string }): Promise<void> {
  const syncUrl = options.syncUrl || process.env.XTCTX_SYNC_URL || "https://sync.xtctx.com";
  const deviceName = options.deviceName || hostname() || "default-device";

  console.log(`\nConnecting to xtctx cloud at ${syncUrl}...`);

  let codeData: DeviceCodeResponse;
  try {
    const res = await fetch(`${syncUrl.replace(/\/$/, "")}/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Failed to request device authorization (${res.status}): ${await res.text()}`);
    }
    codeData = (await res.json()) as DeviceCodeResponse;
  } catch (err: unknown) {
    console.error("\n❌ Could not connect to auth service:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log("\n=======================================================");
  console.log(`  1. Copy your one-time code:  \x1b[1m\x1b[32m${codeData.user_code}\x1b[0m`);
  console.log(`  2. Open in your browser:     \x1b[34m${codeData.verification_uri}\x1b[0m`);
  console.log("=======================================================\n");

  console.log("Waiting for authorization in browser...");

  const interval = (codeData.interval || 5) * 1000;
  const pollUrl = `${syncUrl.replace(/\/$/, "")}/auth/device/poll`;

  while (true) {
    await new Promise((r) => setTimeout(r, interval));

    try {
      const pollRes = await fetch(pollUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_code: codeData.device_code,
          device_name: deviceName,
        }),
      });

      const pollData = (await pollRes.json()) as {
        token?: string;
        user?: { id: string; username: string; name?: string };
        error?: string;
      };

      if (pollData.token && pollData.user) {
        await saveCredentials({
          token: pollData.token,
          user: pollData.user,
          deviceId: `dev_${Date.now()}`,
          deviceName,
          syncUrl,
        });

        console.log(`\n✓ Successfully authenticated as \x1b[1m${pollData.user.username}\x1b[0m`);
        console.log(`✓ Device registered as: \x1b[32m${deviceName}\x1b[0m`);
        console.log("✓ Credentials saved to ~/.xtctx/credentials.json\n");
        return;
      }

      if (pollData.error && pollData.error !== "authorization_pending") {
        console.error(`\n❌ Authentication error: ${pollData.error}`);
        process.exit(1);
      }
    } catch {
      // Continue polling until timeout or success
    }
  }
}
