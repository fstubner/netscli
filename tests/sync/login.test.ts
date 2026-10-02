import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLogin, runLogout } from "@xtctx/cli/login";
import { getCredentialsPath, saveCredentials } from "@xtctx/sync/client";
import { isOptedIn } from "@xtctx/sync/consent";
import { sandbox } from "./helpers";

const code = { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 60, interval: 5 };
const user = { id: "github:1", username: "u" };

describe("login and logout", () => {
  let box: ReturnType<typeof sandbox>;
  beforeEach(() => {
    box = sandbox();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    box.cleanup();
  });

  /** A clock the injected wait advances, so deadlines can be reached without sleeping. */
  const clock = () => {
    const waits: number[] = [];
    return { waits, wait: async (ms: number) => void (waits.push(ms), vi.setSystemTime(Date.now() + ms)) };
  };

  it("signs in without opting any project in", async () => {
    const polls = [{ error: "authorization_pending" }, { token: "tok", user }];
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      Response.json(String(url).endsWith("/code") ? code : polls.shift()),
    ));
    const { wait } = clock();

    await runLogin({ syncUrl: "https://sync.test", wait });

    expect(existsSync(getCredentialsPath())).toBe(true);
    expect(await isOptedIn(box.project)).toBe(false);
  });

  it("slows down when told to, and gives up when the code expires", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      Response.json(String(url).endsWith("/code") ? { ...code, expires_in: 30 } : { error: "slow_down" }),
    ));
    const { wait, waits } = clock();

    await expect(runLogin({ syncUrl: "https://sync.test", wait })).rejects.toThrow(/expired/);

    expect(waits[0]).toBe(5000);
    expect(waits[1]).toBe(10_000); // slow_down adds five seconds
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30_000);
    expect(waits.length).toBeLessThan(10); // bounded, not a forever loop
  });

  it("logout revokes at the server and forgets the token", async () => {
    await saveCredentials({ token: "tok", user, deviceId: "d", deviceName: "n", syncUrl: "https://sync.test" });
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await runLogout({});

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sync.test/auth/logout");
    expect(init.method).toBe("POST");
    expect(existsSync(getCredentialsPath())).toBe(false);
  });

  it("names the device with a random label, not the hostname, unless told otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).endsWith("/code") ? code : { token: "tok", user })));
    const { wait } = clock();
    await runLogin({ syncUrl: "https://sync.test", wait });
    const saved = JSON.parse(readFileSync(getCredentialsPath(), "utf-8"));
    expect(saved.deviceName).toMatch(/^device-[0-9a-f]{6}$/);
    expect(saved.deviceName).not.toContain(hostname());

    await runLogin({ syncUrl: "https://sync.test", wait, deviceName: "work laptop" });
    expect(JSON.parse(readFileSync(getCredentialsPath(), "utf-8")).deviceName).toBe("work laptop");
  });

  it("says plainly when the account is not on the server's allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).endsWith("/code") ? Response.json(code) : Response.json({ error: "not_allowed" }, { status: 403 }),
    ));
    const { wait } = clock();
    await expect(runLogin({ syncUrl: "https://sync.test", wait })).rejects.toThrow(/not allowed on this xtctx cloud server/);
    expect(existsSync(getCredentialsPath())).toBe(false);
  });

  it("delete-data with a login the server no longer accepts deletes nothing, says so, and keeps the login", async () => {
    await saveCredentials({ token: "tok", user, deviceId: "d", deviceName: "n", syncUrl: "https://sync.test" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 })));
    const log = vi.spyOn(console, "log");

    await expect(runLogout({ deleteData: true })).rejects.toThrow(/nothing was deleted.*xtctx login/s);

    expect(existsSync(getCredentialsPath())).toBe(true);
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/Deleted/);
  });

  it("delete-data keeps the login when the server could not delete", async () => {
    await saveCredentials({ token: "tok", user, deviceId: "d", deviceName: "n", syncUrl: "https://sync.test" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    await expect(runLogout({ deleteData: true })).rejects.toThrow(/still logged in/);
    expect(existsSync(getCredentialsPath())).toBe(true);
  });
});
