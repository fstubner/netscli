import { expect, vi } from "vitest";
import worker from "../src/index.js";
import { fakeCtx, PUBLIC_URL } from "./fake-env.js";

export function call(env: unknown, path: string, init: RequestInit & { token?: string; base?: string } = {}) {
  const { token, base, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return worker.fetch(new Request(`${base ?? PUBLIC_URL}${path}`, { ...rest, headers }), env as never, fakeCtx());
}

/** GitHub's side of both sign-in flows, answered as a user with this id. Records what was asked. */
export function stubGitHub(id: number, login: string, options: { tokenError?: string; userStatus?: number } = {}) {
  const seen: Array<{ url: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      seen.push({ url: u, body: typeof init?.body === "string" ? init.body : undefined });
      if (u.includes("login/device/code")) {
        return Response.json({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
      }
      if (u.includes("oauth/access_token")) {
        return options.tokenError ? Response.json({ error: options.tokenError }) : Response.json({ access_token: "gh-token" });
      }
      if (u.includes("api.github.com/user")) {
        return options.userStatus ? new Response("nope", { status: options.userStatus }) : Response.json({ id, login, name: login });
      }
      throw new Error(`unexpected fetch ${u}`);
    }),
  );
  return seen;
}

/** Sign in through the CLI's device flow; returns the CLI token. */
export async function login(env: unknown, id: number, name = `user${id}`): Promise<string> {
  stubGitHub(id, name);
  const res = await call(env, "/auth/device/poll", { method: "POST", body: JSON.stringify({ device_code: "dc" }) });
  expect(res.status).toBe(200);
  vi.unstubAllGlobals();
  return ((await res.json()) as { token: string }).token;
}

export const hex = (n: number) => n.toString(16).padStart(16, "0");

export function message(i: number, over: Record<string, unknown> = {}) {
  return {
    id: hex(i),
    timestamp: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    role: "user",
    content: `message ${i}`,
    messageIndex: i,
    contentHash: `hash${i}`,
    metadataJson: "{}",
    ...over,
  };
}

export function session(over: Record<string, unknown> = {}, messages = [message(0)]) {
  return {
    tool: "claude-code",
    sourceSessionId: "s1",
    gitBranch: "main",
    gitCommit: null,
    startedAt: "2026-10-01T00:00:00.000Z",
    lastActivityAt: "2026-10-01T00:01:00.000Z",
    preview: "hello",
    messages,
    ...over,
  };
}

export function upload(sessions: unknown[], over: Record<string, unknown> = {}) {
  return {
    device: { id: "laptop", name: "Laptop" },
    project: { repoUrl: "github.com/a/b", name: "b" },
    sessions,
    ...over,
  };
}

export function post(env: unknown, token: string, body: unknown) {
  return call(env, "/api/stream", { method: "POST", token, body: JSON.stringify(body) });
}

/** A legacy-era JSON-RPC request to /mcp. */
export async function rpc(env: unknown, token: string, method: string, params?: Record<string, unknown>) {
  const res = await call(env, "/mcp", {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export async function callTool(env: unknown, token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(env, token, "tools/call", { name, arguments: args });
  return body;
}

export const toolText = (body: Record<string, any>) => String(body.result?.content?.[0]?.text ?? "");
