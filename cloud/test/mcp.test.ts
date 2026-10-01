/**
 * Streamable HTTP and JSON-RPC behaviour of POST /mcp, for both eras:
 * legacy (initialize handshake, 2025-06-18 / 2025-11-25) and modern
 * (per-request _meta and mirrored headers, 2026-07-28).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnv } from "./fake-env.js";
import { call, login } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const MODERN = "2026-07-28";
const meta = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} };

async function setup() {
  const { env } = createEnv();
  return { env, token: await login(env, 1) };
}

function send(env: unknown, token: string, body: unknown, headers: Record<string, string> = {}) {
  return call(env, "/mcp", {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function modern(env: unknown, token: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return send(
    env,
    token,
    { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } },
    { "MCP-Protocol-Version": MODERN, "Mcp-Method": method, ...(params.name ? { "Mcp-Name": String(params.name) } : {}), ...headers },
  );
}

describe("legacy era", () => {
  it("negotiates a supported version on initialize and answers ping with {}", async () => {
    const { env, token } = await setup();
    const init = await send(env, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(((await init.json()) as any).result.protocolVersion).toBe("2025-06-18");
    const old = await send(env, token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(((await old.json()) as any).result.protocolVersion).toBe("2025-11-25");

    const ping = await send(env, token, { jsonrpc: "2.0", id: 3, method: "ping" }, { "MCP-Protocol-Version": "2025-11-25" });
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("answers every notification with 202 and no body", async () => {
    const { env, token } = await setup();
    for (const method of ["notifications/initialized", "notifications/cancelled", "notifications/whatever"]) {
      const res = await send(env, token, { jsonrpc: "2.0", method });
      expect(res.status, method).toBe(202);
      expect(await res.text()).toBe("");
    }
  });

  it("answers an unknown method with -32601", async () => {
    const { env, token } = await setup();
    const res = await send(env, token, { jsonrpc: "2.0", id: 1, method: "resources/list" });
    expect(((await res.json()) as any).error.code).toBe(-32601);
  });

  it("refuses an unsupported MCP-Protocol-Version header with 400", async () => {
    const { env, token } = await setup();
    const res = await send(env, token, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "MCP-Protocol-Version": "2024-01-01" });
    expect(res.status).toBe(400);
  });
});

describe("malformed input", () => {
  it("answers bad JSON with 400 and -32700", async () => {
    const { env, token } = await setup();
    const res = await send(env, token, "{ not json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32700);
  });

  it("answers a missing method, a bad id or a non-2.0 message with 400 and -32600", async () => {
    const { env, token } = await setup();
    for (const body of [{ jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: null, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }, 42]) {
      const res = await send(env, token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as any).error.code).toBe(-32600);
    }
  });

  it("rejects JSON-RPC batches with -32600", async () => {
    const { env, token } = await setup();
    const res = await send(env, token, [{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32600);
  });

  it("accepts a JSON-RPC response from the client with 202", async () => {
    const { env, token } = await setup();
    expect((await send(env, token, { jsonrpc: "2.0", id: 5, result: {} })).status).toBe(202);
  });
});

describe("transport methods", () => {
  it("answers GET and DELETE /mcp with 405", async () => {
    const { env, token } = await setup();
    for (const method of ["GET", "DELETE"]) {
      const res = await call(env, "/mcp", { method, token });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });
});

describe("modern era (2026-07-28)", () => {
  it("implements server/discover", async () => {
    const { env, token } = await setup();
    const res = await modern(env, token, "server/discover");
    expect(res.status).toBe(200);
    const result = ((await res.json()) as any).result;
    expect(result.resultType).toBe("complete");
    expect(result.supportedVersions).toEqual([MODERN]);
    expect(result.capabilities).toHaveProperty("tools");
    expect(result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("xtctx-cloud");
    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe("public");
  });

  it("puts the required caching hints on tools/list", async () => {
    // Claude Code 2.1.278 refused a modern tools/list without them.
    const { env, token } = await setup();
    const result = ((await (await modern(env, token, "tools/list")).json()) as any).result;
    expect(result.tools).toHaveLength(3);
    expect(Number.isInteger(result.ttlMs) && result.ttlMs >= 0).toBe(true);
    expect(result.cacheScope).toBe("public");
  });

  it("calls tools statelessly with resultType on every result", async () => {
    const { env, token } = await setup();
    const res = await modern(env, token, "tools/call", { name: "xtctx_cloud_status", arguments: {} });
    expect(res.status).toBe(200);
    const result = ((await res.json()) as any).result;
    expect(result.resultType).toBe("complete");
    expect(result.content[0].text).toContain("Nothing has been uploaded");
    const ping = await modern(env, token, "ping");
    expect(((await ping.json()) as any).result.resultType).toBe("complete");
  });

  it("answers an unknown method with 404 and -32601", async () => {
    const { env, token } = await setup();
    const res = await modern(env, token, "prompts/list");
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe(-32601);
  });

  it("answers an unsupported version with 400 -32022 listing what is supported", async () => {
    const { env, token } = await setup();
    const res = await send(
      env,
      token,
      { jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } },
      { "MCP-Protocol-Version": "2099-01-01", "Mcp-Method": "ping" },
    );
    expect(res.status).toBe(400);
    const error = ((await res.json()) as any).error;
    expect(error.code).toBe(-32022);
    expect(error.data.supported).toContain(MODERN);
    expect(error.data.requested).toBe("2099-01-01");
  });

  it("refuses headers that disagree with the body with 400 -32020", async () => {
    const { env, token } = await setup();
    const cases: Array<Record<string, string>> = [
      { "MCP-Protocol-Version": "2025-11-25" },
      { "Mcp-Method": "tools/list" },
      { "Mcp-Name": "xtctx_cloud_recent_sessions" },
    ];
    for (const headers of cases) {
      const res = await modern(env, token, "tools/call", { name: "xtctx_cloud_status", arguments: {} }, headers);
      expect(res.status, JSON.stringify(headers)).toBe(400);
      expect(((await res.json()) as any).error.code).toBe(-32020);
    }
  });

  it("decodes a base64 Mcp-Name before comparing it", async () => {
    const { env, token } = await setup();
    const encoded = `=?base64?${btoa("xtctx_cloud_status")}?=`;
    const res = await modern(env, token, "tools/call", { name: "xtctx_cloud_status", arguments: {} }, { "Mcp-Name": encoded });
    expect(res.status).toBe(200);
  });

  it("answers a request missing required _meta fields with 400 -32602", async () => {
    const { env, token } = await setup();
    const res = await send(
      env,
      token,
      { jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } } },
      { "MCP-Protocol-Version": MODERN, "Mcp-Method": "ping" },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32602);
  });
});

describe("unauthenticated", () => {
  it("gets a 401 whose challenge names the resource metadata and the read scope", async () => {
    const { env } = createEnv();
    const res = await call(env, "/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain('resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('scope="read"');
  });
});
