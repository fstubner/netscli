/**
 * What leaves the machine, and when.
 *
 * Every case runs against the real index schema in a throwaway home. The first
 * version of this feature selected a column the index does not have, so it
 * could never have uploaded anything; only a real database shows that.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvCredentialsRefusedError, saveCredentials, type SyncCredentials } from "@xtctx/sync/client";
import { setOptedIn } from "@xtctx/sync/consent";
import { CloudAuthError, NotOptedInError, runDiffSync } from "@xtctx/sync/diff-sync";
import { accountKey, acquireUploadLock, readAccountState, updateAccountState } from "@xtctx/sync/state";
import { UPLOAD_LIMITS } from "@xtctx/sync/upload-format";
import { editIndex, fakeCloud, localId, sandbox, seedIndex } from "./helpers";

const creds = (id = "github:1", over: Partial<SyncCredentials> = {}): SyncCredentials => ({
  token: "tok",
  user: { id, username: "u" },
  deviceId: "dev",
  deviceName: "device-abc123",
  syncUrl: "https://sync.test",
  ...over,
});

describe("diff sync", () => {
  let box: ReturnType<typeof sandbox>;
  let cloud: ReturnType<typeof fakeCloud>;

  beforeEach(() => {
    box = sandbox();
    cloud = fakeCloud();
    vi.stubGlobal("fetch", cloud.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    box.cleanup();
  });

  const optedIn = async (c = creds()) => {
    await saveCredentials(c);
    await setOptedIn(box.project, true);
  };
  const state = () => readAccountState(box.project, accountKey("github:1", "https://sync.test"));

  it("uploads nothing for a logged-in user whose project is not opted in", async () => {
    await saveCredentials(creds());
    seedIndex(box.project, 3);
    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(NotOptedInError);
    expect(cloud.requests).toEqual([]);
  });

  it("uploads nothing when only XTCTX_TOKEN is set", async () => {
    vi.stubEnv("XTCTX_TOKEN", "a.b.c");
    seedIndex(box.project, 3);
    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(NotOptedInError);
    expect(cloud.requests).toEqual([]);
  });

  it("uploads an opted-in project, and only what is new on the next run", async () => {
    await optedIn();
    seedIndex(box.project, 3);

    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(3);
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(0);

    // Stamped when written, as the scanner does.
    seedIndex(box.project, 2, new Date().toISOString(), 3);
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(2);
    expect(cloud.stored()).toHaveLength(5);
    expect(cloud.uploads()[0].headers.get("X-Xtctx-Client")).toMatch(/^xtctx\/\d/);
  });

  it("does not advance past a failed upload: the next run sends it all", async () => {
    await optedIn();
    seedIndex(box.project, 3);
    cloud.state.failStatus = 500;

    await expect(runDiffSync({ projectDir: box.project })).rejects.toThrow(/500/);
    const failed = await state();
    expect(failed.cursor).toBeUndefined();
    expect(failed.lastError).toMatch(/500/);

    cloud.state.failStatus = undefined;
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(3);
    const ok = await state();
    expect(ok.lastError).toBeUndefined();
    expect(ok.lastSuccessAt).toBeTruthy();
  });

  it("makes a local deletion reach the cloud", async () => {
    await optedIn();
    seedIndex(box.project, 3);
    await runDiffSync({ projectDir: box.project });
    expect(cloud.stored()).toHaveLength(3);

    // A re-read dropped a message and touched the session.
    editIndex(box.project, (db) => {
      db.prepare("DELETE FROM messages WHERE id = ?").run(localId(2));
      db.prepare("UPDATE sessions SET updated_at = ?").run(new Date().toISOString());
    });
    await runDiffSync({ projectDir: box.project });

    expect(cloud.stored().map((m) => m.id).sort()).toEqual([localId(0), localId(1)]);
  });

  it("replaces a message whose content changed at the same position instead of duplicating it", async () => {
    await optedIn();
    seedIndex(box.project, 2);
    await runDiffSync({ projectDir: box.project });

    // The scanner's re-read: the old row goes, the new one (new id) comes in.
    editIndex(box.project, (db) => db.prepare("DELETE FROM messages WHERE id = ?").run(localId(1)));
    seedIndex(box.project, 1, { from: 1, indexedAt: new Date().toISOString(), content: () => "message 1, edited" });
    // Same index 1 but a fresh id would collide with localId(1); give it another.
    editIndex(box.project, (db) => db.prepare("UPDATE messages SET id = ? WHERE content = 'message 1, edited'").run(localId(99)));

    await runDiffSync({ projectDir: box.project });
    expect(cloud.stored().map((m) => m.content).sort()).toEqual(["message 0", "message 1, edited"]);
  });

  it("uploads only the sessions the index attributes to this project, compared the way the index compares roots", async () => {
    await optedIn();
    // Stored with a trailing separator and in another case: the same root to the index.
    const sameRoot = (process.platform === "win32" ? box.project.toUpperCase() : box.project) + "/";
    seedIndex(box.project, 2, { projectRoot: sameRoot });
    seedIndex(box.project, 2, { sessionId: "elsewhere", projectRoot: join(box.root, "some-other-project") });

    await runDiffSync({ projectDir: box.project });

    expect(cloud.stored("s1")).toHaveLength(2);
    expect(cloud.stored("elsewhere")).toHaveLength(0);
    expect(JSON.stringify(cloud.requests)).not.toContain("elsewhere");
  });

  it("sends no absolute paths, source pointers or hostname", async () => {
    await optedIn();
    seedIndex(box.project, 1, {
      sourcePointer: "/home/alice/.gemini/antigravity/brain/x/task.md",
      metadata: {
        messageIndex: 0,
        toolName: "run_command",
        sourcePath: "C:\\Users\\alice\\repo",
        referencedFiles: ["/home/alice/repo/a.ts"],
        artifactName: "/home/alice/notes.md",
        model: "gemini",
      },
    });

    await runDiffSync({ projectDir: box.project });

    const sent = JSON.stringify(cloud.uploads());
    expect(sent).not.toContain("alice");
    expect(sent).not.toContain("sourcePointer");
    expect(sent).not.toContain(hostname());
    expect(JSON.parse(cloud.stored()[0].metadataJson)).toEqual({ messageIndex: 0, toolName: "run_command", model: "gemini" });
    expect(cloud.uploads()[0].body.project.name).toBe("project");
    expect(cloud.uploads()[0].body.device.name).toBe("device-abc123");
  });

  it("sends the subagent markers the scrapers add, and not Copilot CLI's parent tool-call id", async () => {
    await optedIn();
    seedIndex(box.project, 1, {
      metadata: { messageIndex: 0, subagent: true, subagentType: "explore", parentToolCallId: "call_8f2a" },
    });

    await runDiffSync({ projectDir: box.project });

    expect(JSON.parse(cloud.stored()[0].metadataJson)).toEqual({ messageIndex: 0, subagent: true, subagentType: "explore" });
  });

  it("truncates a message over the server's limit, with a marker", async () => {
    await optedIn();
    seedIndex(box.project, 1, { content: () => "x".repeat(UPLOAD_LIMITS.maxMessageBytes * 2) });
    await runDiffSync({ projectDir: box.project });
    const content = cloud.stored()[0].content;
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(UPLOAD_LIMITS.maxMessageBytes);
    expect(content).toContain("[xtctx: truncated for upload");
  });

  it("skips and records a message the server refuses as too large, and the rest still uploads", async () => {
    await optedIn();
    seedIndex(box.project, 3);
    cloud.state.tooLarge.add(localId(1));

    const result = await runDiffSync({ projectDir: box.project });

    expect(result.skipped.map((s) => s.messageId)).toEqual([localId(1)]);
    expect(cloud.stored().map((m) => m.id).sort()).toEqual([localId(0), localId(2)]);
    expect((await state()).skipped).toEqual([expect.objectContaining({ messageId: localId(1), sessionRef: "claude-code:s1" })]);

    // Not offered again, and not counted against the session.
    const before = cloud.sentMessages().length;
    editIndex(box.project, (db) => db.prepare("UPDATE sessions SET updated_at = ?").run(new Date().toISOString()));
    await runDiffSync({ projectDir: box.project });
    expect(cloud.sentMessages().slice(before).map((m) => m.id)).not.toContain(localId(1));
  });

  it("splits a large backlog across requests that stay inside the limits", async () => {
    await optedIn();
    seedIndex(box.project, 1200, { content: (i) => `message ${i} ${"y".repeat(1500)}` });
    await runDiffSync({ projectDir: box.project });
    expect(cloud.stored()).toHaveLength(1200);
    for (const r of cloud.uploads()) {
      expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThanOrEqual(UPLOAD_LIMITS.maxBodyBytes);
      const messages = r.body.sessions.reduce((n, s) => n + s.messages.length, 0);
      expect(messages).toBeLessThanOrEqual(UPLOAD_LIMITS.maxMessagesPerRequest);
    }
  });

  it("starts over for a different account", async () => {
    await setOptedIn(box.project, true);
    seedIndex(box.project, 3);
    await saveCredentials(creds("github:1"));
    await runDiffSync({ projectDir: box.project });

    await saveCredentials(creds("github:2"));
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(3);
  });

  it("writes nothing into the project, and keeps its position outside the index", async () => {
    await optedIn();
    seedIndex(box.project, 1);
    await runDiffSync({ projectDir: box.project });
    expect(existsSync(join(box.project, ".xtctx", "project.id"))).toBe(false);
    expect(String(cloud.uploads()[0].body.project.repoUrl)).toMatch(/^local:[0-9a-f]{16}$/);
    expect((await state()).cursor).toBeTruthy();
  });

  it("tells the server a project with nothing new is in sync, but not on every run", async () => {
    await optedIn();
    seedIndex(box.project, 1);
    await runDiffSync({ projectDir: box.project });
    const after = cloud.uploads().length;
    await runDiffSync({ projectDir: box.project });
    expect(cloud.uploads().length).toBe(after); // reported moments ago

    await updateAccountState(box.project, accountKey("github:1", "https://sync.test"), (s) => ({
      ...s,
      lastReportedAt: "2026-01-01T00:00:00.000Z",
    }));
    await runDiffSync({ projectDir: box.project });
    expect(cloud.uploads().length).toBe(after + 1);
    expect(cloud.uploads().at(-1)!.body.sessions).toEqual([]);
  });

  it("refuses to send a token over plain http to a remote host", async () => {
    await optedIn(creds("github:1", { syncUrl: "http://example.com" }));
    seedIndex(box.project, 1);
    await expect(runDiffSync({ projectDir: box.project })).rejects.toThrow(/https/);
    expect(cloud.requests).toEqual([]);
  });

  it("says to log in again when the server refuses the token", async () => {
    await optedIn();
    seedIndex(box.project, 1);
    cloud.state.failStatus = 401;
    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(CloudAuthError);
    expect((await state()).lastError).toMatch(/xtctx login/);
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

describe("environment credentials", () => {
  let box: ReturnType<typeof sandbox>;
  let cloud: ReturnType<typeof fakeCloud>;
  beforeEach(async () => {
    box = sandbox();
    cloud = fakeCloud();
    vi.stubGlobal("fetch", cloud.fetch);
    await saveCredentials(creds());
    await setOptedIn(box.project, true);
    seedIndex(box.project, 1);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    box.cleanup();
  });

  it("refuses to upload with an XTCTX_TOKEN that differs from the saved login", async () => {
    vi.stubEnv("XTCTX_TOKEN", "someone-elses.token.x");
    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(EnvCredentialsRefusedError);
    expect(cloud.requests).toEqual([]);
  });

  it("refuses to send the saved token to an XTCTX_SYNC_URL that differs from the saved one", async () => {
    vi.stubEnv("XTCTX_SYNC_URL", "https://collector.example");
    await expect(runDiffSync({ projectDir: box.project })).rejects.toBeInstanceOf(EnvCredentialsRefusedError);
    expect(cloud.requests).toEqual([]);
  });

  it("uploads with them when XTCTX_ALLOW_ENV_CREDENTIALS=1 says that is intended", async () => {
    vi.stubEnv("XTCTX_SYNC_URL", "https://other.example");
    vi.stubEnv("XTCTX_ALLOW_ENV_CREDENTIALS", "1");
    await runDiffSync({ projectDir: box.project });
    expect(cloud.uploads()[0].url).toBe("https://other.example/api/stream");
  });

  it("is fine with env values that match the saved login", async () => {
    vi.stubEnv("XTCTX_TOKEN", "tok");
    vi.stubEnv("XTCTX_SYNC_URL", "https://sync.test/");
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(1);
  });
});

describe("one uploader per project", () => {
  let box: ReturnType<typeof sandbox>;
  let cloud: ReturnType<typeof fakeCloud>;
  beforeEach(async () => {
    box = sandbox();
    cloud = fakeCloud();
    vi.stubGlobal("fetch", cloud.fetch);
    await saveCredentials(creds());
    await setOptedIn(box.project, true);
    seedIndex(box.project, 2);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    box.cleanup();
  });

  it("does nothing while another live process holds the lock", async () => {
    const held = await acquireUploadLock(box.project);
    expect(held).not.toBeNull();
    const result = await runDiffSync({ projectDir: box.project });
    expect(result.busy).toBe(true);
    expect(cloud.requests).toEqual([]);
    await held!.release();
    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(2);
  });

  it("takes over a lock left by a process that is gone", async () => {
    const { join: j } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const { realpathSync } = await import("node:fs");
    const key = process.platform === "win32" ? realpathSync(box.project).toLowerCase() : realpathSync(box.project);
    const lockPath = j(box.home, ".xtctx", "sync", `${createHash("sha256").update(key).digest("hex").slice(0, 24)}.lock`);
    mkdirSync(j(box.home, ".xtctx", "sync"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 2 ** 22 + 12345, token: "dead" }));

    expect((await runDiffSync({ projectDir: box.project })).syncedCount).toBe(2);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("never moves the position backwards", async () => {
    const account = accountKey("github:1", "https://sync.test");
    await updateAccountState(box.project, account, (s) => ({ ...s, cursor: "2026-10-01T12:00:00.000Z" }));
    await updateAccountState(box.project, account, (s) => ({ ...s, cursor: "2026-10-01T11:00:00.000Z" }));
    expect((await readAccountState(box.project, account)).cursor).toBe("2026-10-01T12:00:00.000Z");
  });

  it("runs two concurrent syncs as one upload", async () => {
    const [a, b] = await Promise.all([runDiffSync({ projectDir: box.project }), runDiffSync({ projectDir: box.project })]);
    expect([a.busy, b.busy].filter(Boolean)).toHaveLength(1);
    expect(cloud.stored()).toHaveLength(2);
  });
});
