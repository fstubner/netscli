/**
 * What leaves the machine, and when.
 *
 * Every case runs against the real index schema in a throwaway home. The first
 * version of this feature selected a column the index does not have, so it
 * could never have uploaded anything; only a real database shows that.
 */
import { existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveCredentials, type SyncCredentials } from "@xtctx/sync/client";
import { setOptedIn } from "@xtctx/sync/consent";
import { NotOptedInError, runDiffSync } from "@xtctx/sync/diff-sync";
import { sandbox, seedIndex } from "./helpers";

const creds = (id = "github:1"): SyncCredentials => ({
  token: "tok",
  user: { id, username: "u" },
  deviceId: "dev",
  deviceName: "laptop",
  syncUrl: "https://sync.test",
});

describe("diff sync", () => {
  let box: ReturnType<typeof sandbox>;
  let uploads: Array<Array<Record<string, unknown>>>;

  beforeEach(() => {
    box = sandbox();
    uploads = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        uploads.push(JSON.parse(String(init.body)));
        return Response.json({ success: true });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    box.cleanup();
  });

  it("uploads nothing for a logged-in user whose project is not opted in", async () => {
    await saveCredentials(creds());
    seedIndex(box.project, 3);

    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(NotOptedInError);
    expect(uploads).toEqual([]);
  });

  it("uploads nothing when only XTCTX_TOKEN is set", async () => {
    vi.stubEnv("XTCTX_TOKEN", "a.b.c");
    seedIndex(box.project, 3);

    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(NotOptedInError);
    expect(uploads).toEqual([]);
  });

  it("uploads an opted-in project, and only what is new on the next run", async () => {
    await saveCredentials(creds());
    await setOptedIn(box.project, true);
    seedIndex(box.project, 3);

    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(3);
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(0);

    seedIndex(box.project, 2, "2026-10-01T00:00:05.000Z", 3);
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(2);
    expect(uploads.map((b) => b.length)).toEqual([3, 2]);
  });

  it("does not skip messages that share a timestamp across a batch boundary", async () => {
    await saveCredentials(creds());
    await setOptedIn(box.project, true);
    seedIndex(box.project, 250);

    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(250);
    const sent = new Set(uploads.flat().map((d) => d.messageIndex));
    expect(sent.size).toBe(250);
  });

  it("starts over for a different account", async () => {
    await setOptedIn(box.project, true);
    seedIndex(box.project, 3);
    await saveCredentials(creds("github:1"));
    await runDiffSync({ projectDir: box.project });

    await saveCredentials(creds("github:2"));
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(3);
  });

  it("sends the folder name, not the absolute path, and writes nothing into the project", async () => {
    await saveCredentials(creds());
    await setOptedIn(box.project, true);
    seedIndex(box.project, 1);
    const before = existsSync(join(box.project, ".xtctx", "project.id"));

    await runDiffSync({ projectDir: box.project });

    expect(uploads[0][0].projectRoot).toBe("project");
    expect(String(uploads[0][0].repoUrl)).toMatch(/^local:[0-9a-f]{16}$/);
    expect(before).toBe(false);
    expect(existsSync(join(box.project, ".xtctx", "project.id"))).toBe(false);
  });

  it("refuses to send a token over plain http to a remote host", async () => {
    await saveCredentials({ ...creds(), syncUrl: "http://example.com" });
    await setOptedIn(box.project, true);
    seedIndex(box.project, 1);

    await expect(runDiffSync({ projectDir: box.project })).rejects.toThrow(/https/);
    expect(uploads).toEqual([]);
  });

  it("an opt-in for one project does not cover another", async () => {
    await saveCredentials(creds());
    const other = join(box.project, "..", "other");
    mkdirSync(other);
    writeFileSync(join(other, "marker"), "");
    await setOptedIn(other, true);
    seedIndex(box.project, 1);

    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(NotOptedInError);
  });
});
