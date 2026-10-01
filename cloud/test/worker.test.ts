import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { createJwt } from "../src/auth.js";
import { createEnv } from "./fake-env.js";

const OLD_DEFAULT_SECRET = "xtctx-cloud-default-secret-change-in-production";

function call(env: unknown, path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return worker.fetch(new Request(`https://sync.test${path}`, { ...rest, headers }), env as never);
}

/** The GitHub side of the device flow, answered as a user with this id. */
function stubGitHub(id: number, login: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("oauth/access_token")
        ? Response.json({ access_token: "gh-token" })
        : Response.json({ id, login, name: login }),
    ),
  );
}

async function login(env: unknown, id: number, name: string): Promise<string> {
  stubGitHub(id, name);
  const res = await call(env, "/auth/device/poll", {
    method: "POST",
    body: JSON.stringify({ device_code: "dc", device_name: "laptop" }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const turn = (over: Record<string, unknown> = {}) => ({
  deviceId: "laptop",
  tool: "claude-code",
  sourceSessionId: "s1",
  repoUrl: "github.com/a/b",
  projectRoot: "b",
  timestamp: "2026-10-01T00:00:00.000Z",
  role: "user",
  content: "hello",
  messageIndex: 0,
  contentHash: "abcdef0123456789",
  ...over,
});

const listTools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

afterEach(() => vi.unstubAllGlobals());

describe("without a signing secret", () => {
  it("refuses everything but the health check, even for a token signed with the old built-in default", async () => {
    const { env } = createEnv({ JWT_SECRET: undefined });
    const forged = await createJwt({ sub: "github:1", username: "x", ver: 0 }, OLD_DEFAULT_SECRET);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const path of ["/api/stream", "/mcp", "/sse", "/auth/device/code"]) {
      const res =
        path === "/sse"
          ? await call(env, path, { token: forged })
          : await call(env, path, { method: "POST", token: forged, body: "{}" });
      expect(res.status, path).toBe(500);
      expect(await res.json()).toEqual({ error: "server_misconfigured" });
    }
    expect((await call(env, "/health")).status).toBe(200);
    spy.mockRestore();
  });
});

describe("authentication", () => {
  it("does not take a token from the query string", async () => {
    const { env } = createEnv();
    const token = await login(env, 1, "alice");

    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(200);
    expect((await call(env, `/mcp?token=${token}`, { method: "POST", body: listTools })).status).toBe(401);
  });

  it("stops accepting a token after logout", async () => {
    const { env } = createEnv();
    const token = await login(env, 1, "alice");
    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(200);

    expect((await call(env, "/auth/logout", { method: "POST", token })).status).toBe(200);

    expect((await call(env, "/mcp", { method: "POST", token, body: listTools })).status).toBe(401);
    // Signing in again gives a token that works.
    const fresh = await login(env, 1, "alice");
    expect((await call(env, "/mcp", { method: "POST", token: fresh, body: listTools })).status).toBe(200);
  });
});

describe("delete my data", () => {
  it("removes the caller's rows and tokens and leaves other users alone", async () => {
    const { env, db } = createEnv();
    const alice = await login(env, 1, "alice");
    const bob = await login(env, 2, "bob");
    for (const token of [alice, bob]) {
      const res = await call(env, "/api/stream", { method: "POST", token, body: JSON.stringify([turn()]) });
      expect(res.status).toBe(200);
    }
    const messages = (user: string) =>
      (db.prepare("SELECT count(*) n FROM messages WHERE session_ref LIKE ?").get(`${user}:%`) as { n: number }).n;
    const owned = (table: string, user: string) =>
      (db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id = ?`).get(user) as { n: number }).n;
    expect(messages("github:1")).toBe(1);

    expect((await call(env, "/api/me", { method: "DELETE", token: alice })).status).toBe(200);

    expect(messages("github:1")).toBe(0);
    for (const table of ["sessions", "devices"]) expect(owned(table, "github:1"), table).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM users WHERE id = 'github:1'").get()).toEqual({ n: 0 });
    expect(messages("github:2")).toBe(1);
    expect((await call(env, "/mcp", { method: "POST", token: alice, body: listTools })).status).toBe(401);
  });
});

describe("ingest", () => {
  it("answers 400 to a malformed body and 200 to a good one", async () => {
    const { env } = createEnv();
    const token = await login(env, 1, "alice");
    const post = (body: unknown) => call(env, "/api/stream", { method: "POST", token, body: JSON.stringify(body) });

    expect((await post([turn({ role: "wizard" })])).status).toBe(400);
    expect((await post([turn({ messageIndex: "0" })])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post([turn()])).status).toBe(200);
  });

  it("keeps two users who pick the same device id apart", async () => {
    const { env, db } = createEnv();
    const alice = await login(env, 1, "alice");
    const bob = await login(env, 2, "bob");
    for (const token of [alice, bob]) {
      await call(env, "/api/stream", { method: "POST", token, body: JSON.stringify([turn()]) });
    }
    const devices = db.prepare("SELECT id, user_id FROM devices ORDER BY user_id").all();
    expect(devices).toEqual([
      { id: "github:1:laptop", user_id: "github:1" },
      { id: "github:2:laptop", user_id: "github:2" },
    ]);
  });
});

describe("errors", () => {
  it("returns a generic 500 with no message or stack", async () => {
    const { env } = createEnv();
    const token = await login(env, 1, "alice");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await call(env, "/mcp", { method: "POST", token, body: "{ not json" });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("CORS", () => {
  it("sends no CORS headers by default, and only to a listed origin when configured", async () => {
    const plain = createEnv().env;
    const res = await call(plain, "/health", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const configured = createEnv({ ALLOWED_ORIGINS: "https://app.example" }).env;
    const ok = await call(configured, "/health", { headers: { Origin: "https://app.example" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    const other = await call(configured, "/health", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
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
    const token = await login(env, 1, "alice");
    const { endpoint, next, reader } = await openStream(env, token);

    // Another isolate: a fresh module instance, sharing only the bindings.
    vi.resetModules();
    const other = (await import("../src/index.js")).default;
    const post = await other.fetch(
      new Request(`https://sync.test${endpoint.pathname}${endpoint.search}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      }),
      env as never,
    );
    expect(post.status).toBe(202);

    const event = await next();
    expect(event).toContain("event: message");
    expect(JSON.parse(/data: (.*)/.exec(event)![1]).id).toBe(7);
    await reader.cancel();
  });

  it("will not let another user write into someone's stream", async () => {
    const { env } = createEnv();
    const alice = await login(env, 1, "alice");
    const bob = await login(env, 2, "bob");
    const { endpoint, reader } = await openStream(env, alice);

    const res = await call(env, `${endpoint.pathname}${endpoint.search}`, {
      method: "POST",
      token: bob,
      body: listTools,
    });
    expect(res.status).toBe(404);
    await reader.cancel();
  });
});
