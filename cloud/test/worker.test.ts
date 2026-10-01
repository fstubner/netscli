import { afterEach, describe, expect, it, vi } from "vitest";
import { createJwt, mintToken } from "../src/auth.js";
import { LIMITS } from "../src/db.js";
import { SERVER_VERSION } from "../src/version.js";
import { createEnv } from "./fake-env.js";
import { call, callTool, login, message, post, rpc, session, stubGitHub, toolText, upload } from "./helpers.js";

const OLD_DEFAULT_SECRET = "xtctx-cloud-default-secret-change-in-production";
const listTools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("without a signing secret", () => {
  it("refuses everything but the health check, even for a token signed with the old built-in default", async () => {
    const { env } = createEnv({ JWT_SECRET: undefined });
    const forged = await createJwt({ sub: "github:1", username: "x", ver: 0 }, OLD_DEFAULT_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const path of ["/api/stream", "/mcp", "/sse", "/auth/device/code", "/authorize"]) {
      const res =
        path === "/sse" || path === "/authorize"
          ? await call(env, path, { token: forged })
          : await call(env, path, { method: "POST", token: forged, body: "{}" });
      expect(res.status, path).toBe(500);
      expect(await res.json()).toEqual({ error: "server_misconfigured" });
    }
    expect((await call(env, "/health")).status).toBe(200);
  });
});

describe("health", () => {
  it("reports the package version, in the body and a header on every response", async () => {
    const { env } = createEnv();
    const res = await call(env, "/health");
    expect(((await res.json()) as { version: string }).version).toBe(SERVER_VERSION);
    expect(res.headers.get("X-Xtctx-Server-Version")).toBe(SERVER_VERSION);
    expect((await call(env, "/nowhere")).headers.get("X-Xtctx-Server-Version")).toBe(SERVER_VERSION);
  });
});

describe("sign-in allowlist", () => {
  it("refuses a GitHub account that is not listed, before writing anything for it", async () => {
    const { env, db } = createEnv({ ALLOWED_GITHUB_IDS: "1" });
    stubGitHub(99, "mallory");
    const res = await call(env, "/auth/device/poll", { method: "POST", body: JSON.stringify({ device_code: "dc" }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_allowed");
    expect(db.prepare("SELECT count(*) n FROM users").get()).toEqual({ n: 0 });
  });

  it("lets nobody in when the list is empty or unset", async () => {
    for (const value of ["", undefined, " , ,abc"]) {
      const { env } = createEnv({ ALLOWED_GITHUB_IDS: value });
      stubGitHub(1, "alice");
      const res = await call(env, "/auth/device/poll", { method: "POST", body: JSON.stringify({ device_code: "dc" }) });
      expect(res.status, String(value)).toBe(403);
    }
  });

  it("stops a signed-in account's access once it is taken off the list", async () => {
    const { env } = createEnv({ ALLOWED_GITHUB_IDS: "1" });
    const token = await login(env, 1);
    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(200);
    (env as { ALLOWED_GITHUB_IDS: string }).ALLOWED_GITHUB_IDS = "2";
    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(401);
  });
});

describe("/auth/device/poll error paths", () => {
  const poll = (env: unknown, body: string) => call(env, "/auth/device/poll", { method: "POST", body });

  it("answers 400 to a body that is not JSON or has no device code", async () => {
    const { env } = createEnv();
    stubGitHub(1, "alice");
    expect((await poll(env, "{ not json")).status).toBe(400);
    expect((await poll(env, "{}")).status).toBe(400);
    expect((await poll(env, JSON.stringify({ device_code: 7 }))).status).toBe(400);
  });

  it("passes GitHub's pending and slow-down answers through for the client to act on", async () => {
    const { env } = createEnv();
    for (const error of ["authorization_pending", "slow_down", "expired_token", "access_denied"]) {
      stubGitHub(1, "alice", { tokenError: error });
      const res = await poll(env, JSON.stringify({ device_code: "dc" }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    }
  });

  it("answers 502 when GitHub will not say who the user is", async () => {
    const { env, db } = createEnv();
    stubGitHub(1, "alice", { userStatus: 500 });
    expect((await poll(env, JSON.stringify({ device_code: "dc" }))).status).toBe(502);
    expect(db.prepare("SELECT count(*) n FROM users").get()).toEqual({ n: 0 });
  });

  it("answers 502 when GitHub cannot be reached", async () => {
    const { env } = createEnv();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    expect((await poll(env, JSON.stringify({ device_code: "dc" }))).status).toBe(502);
  });
});

describe("tokens", () => {
  it("does not take a token from the query string", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(200);
    expect((await call(env, `/mcp?token=${token}`, { method: "POST", body: listTools })).status).toBe(401);
  });

  it("refuses an expired token", async () => {
    const { env } = createEnv();
    await login(env, 1);
    const expired = await mintToken(env, { userId: "github:1", username: "u", epoch: 0, scopes: ["read", "sync:write"] }, -1);
    expect((await call(env, "/mcp", { method: "POST", token: expired, body: listTools })).status).toBe(401);
    expect((await post(env, expired, upload([session()]))).status).toBe(401);
  });

  it("refuses a token from before scopes existed", async () => {
    const { env } = createEnv();
    await login(env, 1);
    const legacy = await createJwt({ sub: "github:1", username: "u", ver: 0 }, "test-secret-for-the-worker-tests");
    expect((await call(env, "/mcp", { method: "POST", token: legacy, body: listTools })).status).toBe(401);
  });

  it("stops accepting a token after logout, and a fresh login works", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    expect((await call(env, "/auth/logout", { method: "POST", token })).status).toBe(200);
    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(401);
    const fresh = await login(env, 1);
    expect((await call(env, "/mcp", { method: "POST", token: fresh, body: listTools })).status).toBe(200);
  });

  it("a pasted read-only token reads but cannot upload, delete or mint more", async () => {
    const { env } = createEnv();
    const cli = await login(env, 1);
    const res = await call(env, "/api/tokens", { method: "POST", token: cli });
    expect(res.status).toBe(200);
    const { token: read, scope } = (await res.json()) as { token: string; scope: string };
    expect(scope).toBe("read");

    expect((await call(env, "/mcp", { method: "POST", token: read, body: listTools })).status).toBe(200);
    expect((await post(env, read, upload([session()]))).status).toBe(401);
    expect((await call(env, "/api/me", { method: "DELETE", token: read })).status).toBe(401);
    expect((await call(env, "/api/tokens", { method: "POST", token: read })).status).toBe(401);

    // And logout ends it too.
    await call(env, "/auth/logout", { method: "POST", token: cli });
    expect((await call(env, "/mcp", { method: "POST", token: read, body: listTools })).status).toBe(401);
  });

  it("answers a missing scope with 403 insufficient_scope", async () => {
    const { env } = createEnv();
    await login(env, 1);
    const noDelete = await mintToken(env, { userId: "github:1", username: "u", epoch: 0, scopes: ["read", "sync:write"] }, 60);
    const res = await call(env, "/api/me", { method: "DELETE", token: noDelete });
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
  });
});

describe("delete my data", () => {
  it("removes the caller's rows and tokens and leaves other users alone", async () => {
    const { env, db } = createEnv();
    const alice = await login(env, 1);
    const bob = await login(env, 2);
    for (const token of [alice, bob]) expect((await post(env, token, upload([session()]))).status).toBe(200);
    const owned = (table: string, user: string) =>
      (db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id = ?`).get(user) as { n: number }).n;
    const messages = (user: string) =>
      (db.prepare("SELECT count(*) n FROM messages WHERE session_ref LIKE ?").get(`${user}:%`) as { n: number }).n;

    expect((await call(env, "/api/me", { method: "DELETE", token: alice })).status).toBe(200);

    expect(messages("github:1")).toBe(0);
    for (const table of ["sessions", "devices", "uploads"]) expect(owned(table, "github:1"), table).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM users WHERE id = 'github:1'").get()).toEqual({ n: 0 });
    expect(messages("github:2")).toBe(1);
    expect((await call(env, "/mcp", { method: "POST", token: alice, body: listTools })).status).toBe(401);
  });

  it("does not revive a token from before the deletion when the same account signs in again", async () => {
    const { env } = createEnv();
    const old = await login(env, 1);
    expect((await call(env, "/api/me", { method: "DELETE", token: old })).status).toBe(200);

    const fresh = await login(env, 1);

    expect((await call(env, "/mcp", { method: "POST", token: old, body: listTools })).status).toBe(401);
    expect((await post(env, old, upload([session()]))).status).toBe(401);
    expect((await call(env, "/mcp", { method: "POST", token: fresh, body: listTools })).status).toBe(200);
  });
});

describe("ingest", () => {
  it("answers 400 to a malformed body, 426 to the old format, and 200 to a good one", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    expect((await post(env, token, upload([session({}, [message(0, { role: "wizard" })])]))).status).toBe(400);
    expect((await post(env, token, upload([session({}, [message(0, { messageIndex: "0" })])]))).status).toBe(400);
    expect((await post(env, token, upload([session({}, [message(0, { id: "not-hex" })])]))).status).toBe(400);
    expect((await post(env, token, upload([session({ tool: "Bad Tool" })]))).status).toBe(400);
    expect((await post(env, token, { sessions: [] })).status).toBe(400);
    expect((await call(env, "/api/stream", { method: "POST", token, body: "{ nope" })).status).toBe(400);
    expect((await post(env, token, [{ deviceId: "x" }])).status).toBe(426);
    expect((await post(env, token, upload([session()]))).status).toBe(200);
  });

  it("rejects a body over the byte limit with 413, without reading it all", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const huge = "x".repeat(LIMITS.maxBodyBytes + 1);
    const res = await call(env, "/api/stream", { method: "POST", token, body: huge });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("body_too_large");
  });

  it("rejects an oversized message with 413 naming it, and writes nothing from that request", async () => {
    const { env, db } = createEnv();
    const token = await login(env, 1);
    const big = message(1, { content: "é".repeat(LIMITS.maxMessageBytes / 2 + 1) }); // over the limit in bytes, not chars
    const res = await post(env, token, upload([session({}, [message(0), big])]));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "message_too_large", messageId: big.id, sourceSessionId: "s1" });
    expect(db.prepare("SELECT count(*) n FROM messages").get()).toEqual({ n: 0 });
  });

  it("refuses more sessions or messages per request than one batch may hold", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const sessions = Array.from({ length: LIMITS.maxSessionsPerRequest + 1 }, (_, i) => session({ sourceSessionId: `s${i}` }));
    expect((await post(env, token, upload(sessions))).status).toBe(400);
    const many = Array.from({ length: LIMITS.maxMessagesPerRequest + 1 }, (_, i) => message(i));
    expect((await post(env, token, upload([session({}, many)]))).status).toBe(400);
  });

  it("writes a whole request as one batch inside D1's per-invocation query limit", async () => {
    const { env, stats } = createEnv();
    const token = await login(env, 1);
    stats.batches.length = 0;
    const sessions = Array.from({ length: LIMITS.maxSessionsPerRequest }, (_, i) =>
      session({ sourceSessionId: `s${i}`, keepIds: [] }, Array.from({ length: 50 }, (_, j) => message(j))),
    );
    expect((await post(env, token, upload(sessions))).status).toBe(200);
    expect(stats.batches).toHaveLength(1);
    // Free plan: 50 queries per invocation. Plus auth (1) and the recount read (1).
    expect(stats.batches[0] + 2).toBeLessThanOrEqual(50);
  });

  it("is idempotent: replaying an upload does not inflate counts or duplicate rows", async () => {
    const { env, db } = createEnv();
    const token = await login(env, 1);
    const body = upload([session({}, [message(0), message(1), message(2)])]);
    for (let i = 0; i < 3; i++) {
      const res = await post(env, token, body);
      expect(((await res.json()) as { sessions: Array<{ messageCount: number }> }).sessions[0].messageCount).toBe(3);
    }
    expect(db.prepare("SELECT message_count n FROM sessions").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT count(*) n FROM messages").get()).toEqual({ n: 3 });
  });

  it("makes the cloud copy match the local one when keepIds is sent", async () => {
    const { env, db } = createEnv();
    const token = await login(env, 1);
    await post(env, token, upload([session({}, [message(0), message(1), message(2)])]));
    // A local re-read replaced message 1 (new id) and dropped message 2.
    const replaced = message(9, { messageIndex: 1, content: "message 1, edited" });
    const res = await post(env, token, upload([session({ keepIds: [message(0).id, replaced.id] }, [replaced])]));
    expect(((await res.json()) as { sessions: Array<{ messageCount: number }> }).sessions[0].messageCount).toBe(2);
    const contents = db.prepare("SELECT content FROM messages ORDER BY message_index").all().map((r) => (r as { content: string }).content);
    expect(contents).toEqual(["message 0", "message 1, edited"]);
    expect(db.prepare("SELECT message_count n FROM sessions").get()).toEqual({ n: 2 });
  });

  it("keeps the earliest start and latest activity, and updates branch and device", async () => {
    const { env, db } = createEnv();
    const token = await login(env, 1);
    await post(env, token, upload([session({ startedAt: "2026-10-01T00:00:10.000Z", lastActivityAt: "2026-10-01T00:05:00.000Z" })]));
    await post(
      env,
      token,
      upload([session({ startedAt: "2026-10-01T00:00:00.000Z", lastActivityAt: "2026-10-01T00:01:00.000Z", gitBranch: "feat" })], {
        device: { id: "desktop", name: "Desktop" },
      }),
    );
    expect(db.prepare("SELECT started_at, last_activity_at, git_branch, device_id FROM sessions").get()).toEqual({
      started_at: "2026-10-01T00:00:00.000Z",
      last_activity_at: "2026-10-01T00:05:00.000Z",
      git_branch: "feat",
      device_id: "github:1:desktop",
    });
  });

  it("keeps two users who pick the same device id apart", async () => {
    const { env, db } = createEnv();
    for (const token of [await login(env, 1), await login(env, 2)]) await post(env, token, upload([session()]));
    expect(db.prepare("SELECT id, user_id FROM devices ORDER BY user_id").all()).toEqual([
      { id: "github:1:laptop", user_id: "github:1" },
      { id: "github:2:laptop", user_id: "github:2" },
    ]);
  });

  it("logs a failed write with sizes and counts but no content", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (env.DB as unknown as { batch: () => Promise<never> }).batch = async () => {
      throw new Error("D1_ERROR: boom");
    };
    const res = await post(env, token, upload([session({}, [message(0, { content: "very secret words" })])]));
    expect(res.status).toBe(500);
    const logged = String(spy.mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "ingest_failed", userId: "github:1", sessions: 1, messages: 1 });
    expect(logged).not.toContain("very secret words");
  });
});

describe("tool calls are isolated between tenants", () => {
  it("another user's session_ref is not found, and their sessions are never listed", async () => {
    const { env } = createEnv();
    const alice = await login(env, 1);
    const bob = await login(env, 2);
    await post(env, alice, upload([session({}, [message(0, { content: "alice's secret" })])]));

    const detail = await callTool(env, bob, "xtctx_cloud_session_detail", { session_ref: "github:1:claude-code:s1" });
    expect(detail.result.isError).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("alice's secret");

    const recent = await callTool(env, bob, "xtctx_cloud_recent_sessions", { format: "json" });
    expect(JSON.parse(toolText(recent))).toEqual([]);
    const status = await callTool(env, bob, "xtctx_cloud_status", { format: "json" });
    expect(JSON.parse(toolText(status))).toEqual([]);

    // And alice does see hers.
    const own = await callTool(env, alice, "xtctx_cloud_session_detail", { session_ref: "github:1:claude-code:s1" });
    expect(toolText(own)).toContain("alice's secret");
  });
});

describe("errors", () => {
  it("returns a generic 500 with no message or stack", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (env.DB as unknown as { prepare: () => never }).prepare = () => {
      throw new Error("no such table: secret_table");
    };
    const res = await call(env, "/mcp", { method: "POST", token, body: listTools });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(spy).toHaveBeenCalled();
  });
});

describe("CORS", () => {
  it("sends no CORS headers by default, and only to a listed origin when configured", async () => {
    const plain = createEnv().env;
    const res = await call(plain, "/nowhere", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const configured = createEnv({ ALLOWED_ORIGINS: "https://app.example" }).env;
    const ok = await call(configured, "/nowhere", { headers: { Origin: "https://app.example" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    const other = await call(configured, "/nowhere", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("refuses /mcp from a foreign browser origin", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const res = await call(env, "/mcp", { method: "POST", token, body: listTools, headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});

describe("SSE transport", () => {
  async function openStream(env: unknown, token: string) {
    const res = await call(env, "/sse", { token });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const next = async () => decoder.decode((await reader.read()).value);
    const endpoint = /data: (\S+)/.exec(await next())![1];
    return { endpoint: new URL(endpoint), next, reader };
  }

  it("delivers a message posted through a separately loaded copy of the Worker", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const { endpoint, next, reader } = await openStream(env, token);

    // Another isolate: a fresh module instance, sharing only the bindings.
    vi.resetModules();
    const other = (await import("../src/index.js")).default;
    const { fakeCtx } = await import("./fake-env.js");
    const res = await other.fetch(
      new Request(`https://mcp.test${endpoint.pathname}${endpoint.search}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      }),
      env as never,
      fakeCtx(),
    );
    expect(res.status).toBe(202);

    const event = await next();
    expect(event).toContain("event: message");
    expect(JSON.parse(/data: (.*)/.exec(event)![1]).id).toBe(7);
    await reader.cancel();
  });

  it("will not let another user write into someone's stream", async () => {
    const { env } = createEnv();
    const alice = await login(env, 1);
    const bob = await login(env, 2);
    const { endpoint, reader } = await openStream(env, alice);
    const res = await call(env, `${endpoint.pathname}${endpoint.search}`, { method: "POST", token: bob, body: listTools });
    expect(res.status).toBe(404);
    await reader.cancel();
  });

  it("answers an unauthenticated stream with a challenge naming the resource metadata", async () => {
    const { env } = createEnv();
    const res = await call(env, "/sse");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  });
});

describe("tool results", () => {
  it("recent sessions name the device, and session detail pages in conversation order", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    // Out of order on purpose: same timestamp for 1 and 2, index decides.
    const msgs = [
      message(2, { timestamp: "2026-10-01T00:00:05.000Z" }),
      message(0, { timestamp: "2026-10-01T00:00:01.000Z" }),
      message(1, { timestamp: "2026-10-01T00:00:05.000Z" }),
    ];
    await post(env, token, upload([session({}, msgs)]));

    const recent = toolText(await callTool(env, token, "xtctx_cloud_recent_sessions"));
    expect(recent).toContain("Laptop");

    const page = JSON.parse(
      toolText(await callTool(env, token, "xtctx_cloud_session_detail", { session_ref: "github:1:claude-code:s1", format: "json" })),
    );
    expect(page.session.device).toBe("Laptop");
    expect(page.messages.map((m: { message_index: number }) => m.message_index)).toEqual([0, 1, 2]);

    const md = toolText(await callTool(env, token, "xtctx_cloud_session_detail", { session_ref: "github:1:claude-code:s1", limit: 1, offset: 1 }));
    expect(md).toContain("message 1");
    expect(md).toContain("offset 2");
  });

  it("status says when each device last uploaded each project", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    expect(toolText(await callTool(env, token, "xtctx_cloud_status"))).toContain("Nothing has been uploaded");
    await post(env, token, upload([]));
    const rows = JSON.parse(toolText(await callTool(env, token, "xtctx_cloud_status", { format: "json" })));
    expect(rows).toEqual([
      expect.objectContaining({ repo_url: "github.com/a/b", project_name: "b", device_name: "Laptop", sessions: 0 }),
    ]);
  });

  it("clamps limit to 1..25, and a negative one is not unlimited", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    for (let batch = 0; batch < 3; batch++) {
      const sessions = Array.from({ length: 10 }, (_, i) => session({ sourceSessionId: `s${batch}-${i}` }));
      await post(env, token, upload(sessions));
    }
    const count = async (limit: unknown) =>
      JSON.parse(toolText(await callTool(env, token, "xtctx_cloud_recent_sessions", { limit, format: "json" }))).length;
    expect(await count(-1)).toBe(1);
    expect(await count(0)).toBe(1);
    expect(await count(2.7)).toBe(2);
    expect(await count(1000)).toBe(25);
    const bad = await callTool(env, token, "xtctx_cloud_recent_sessions", { limit: "lots" });
    expect(bad.result.isError).toBe(true);
  });

  it("session_detail requires session_ref, and an unknown tool is -32602", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const missing = await callTool(env, token, "xtctx_cloud_session_detail", {});
    expect(missing.result.isError).toBe(true);
    expect(toolText(missing)).toContain("session_ref is required");
    const unknown = await callTool(env, token, "xtctx_recent_sessions", {});
    expect(unknown.error.code).toBe(-32602);
  });

  it("names the tools so they cannot collide with the local server's", async () => {
    const { env } = createEnv();
    const token = await login(env, 1);
    const { body } = await rpc(env, token, "tools/list");
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "xtctx_cloud_recent_sessions",
      "xtctx_cloud_session_detail",
      "xtctx_cloud_status",
    ]);
  });
});
