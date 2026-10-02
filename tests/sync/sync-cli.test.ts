import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSync, runSyncSetting } from "@xtctx/cli/sync";
import { saveCredentials } from "@xtctx/sync/client";
import { setOptedIn } from "@xtctx/sync/consent";
import { editIndex, fakeCloud, sandbox, seedIndex } from "./helpers";

const creds = { token: "tok", user: { id: "github:1", username: "alice" }, deviceId: "d", deviceName: "device-abc123", syncUrl: "https://sync.test" };

describe("xtctx sync", () => {
  let box: ReturnType<typeof sandbox>;
  let cloud: ReturnType<typeof fakeCloud>;
  let out: string[];
  beforeEach(async () => {
    box = sandbox();
    cloud = fakeCloud();
    vi.stubGlobal("fetch", cloud.fetch);
    out = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
    process.exitCode = 0;
    await saveCredentials(creds);
    await setOptedIn(box.project, true);
    seedIndex(box.project, 2);
  });
  afterEach(() => {
    process.exitCode = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    box.cleanup();
  });

  it("exits non-zero when the upload fails, and zero when it works", async () => {
    cloud.state.failStatus = 500;
    await runSync({ projectDir: box.project });
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toMatch(/Cloud sync failed/);

    cloud.state.failStatus = undefined;
    await runSync({ projectDir: box.project });
    expect(process.exitCode).toBe(0);
  });

  it("status shows the last upload and the last failure", async () => {
    await runSync({ projectDir: box.project });
    cloud.state.failStatus = 503;
    editIndex(box.project, (db) => db.prepare("UPDATE sessions SET updated_at = ?").run(new Date().toISOString()));
    await runSync({ projectDir: box.project });
    out.length = 0;

    await runSyncSetting("status", { projectDir: box.project });

    const text = out.join("\n");
    expect(text).toMatch(/on; uploading as alice to https:\/\/sync.test, device "device-abc123"/);
    expect(text).toMatch(/last upload: 20\d\d-/);
    expect(text).toMatch(/last attempt FAILED at .*503/);
  });

  it("renames this device", async () => {
    await runSyncSetting("device", { projectDir: box.project, value: "studio mac" });
    await runSync({ projectDir: box.project });
    expect(cloud.uploads()[0].body.device.name).toBe("studio mac");
  });
});
