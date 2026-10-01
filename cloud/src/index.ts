import type { Env } from "./types.js";
import { authenticateRequest, getProtectedResourceMetadata, createJwt } from "./auth.js";
import {
  bumpTokenVersion,
  deleteUserData,
  getTokenVersion,
  ingestTurnDelta,
  parseTurnDeltas,
  upsertUser,
} from "./db.js";
import { processJsonRpc } from "./mcp.js";

export { SseSession } from "./sse-session.js";

const SESSION_ID = /^[0-9a-f-]{36}$/;

/**
 * CORS is for browsers, and nothing here is called from one: the CLI and MCP
 * clients are not subject to it. So the default is no CORS headers at all,
 * and an origin gets them only by being listed in ALLOWED_ORIGINS.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Mcp-Session-Id";
  }
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", ...extra },
      });

    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          status: "ok",
          service: "xtctx-cloud",
          mcp: {
            supportedVersions: ["2026-07-28", "2024-11-05"],
            endpoints: { stateless: "/mcp", sse: "/sse" },
          },
        });
      }

      // Without a signing secret nothing below can be trusted, so none of it
      // runs. There used to be a built-in default, which made every token
      // forgeable on a deployment that forgot to set one.
      if (!env.JWT_SECRET) {
        console.error("JWT_SECRET is not set; refusing to serve");
        return json({ error: "server_misconfigured" }, 500);
      }

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return json(getProtectedResourceMetadata(url.origin));
      }

      if (url.pathname === "/auth/device/code" && request.method === "POST") {
        const ghRes = await fetch("https://github.com/login/device/code", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, scope: "read:user user:email" }),
        });
        return json(await ghRes.json());
      }

      if (url.pathname === "/auth/device/poll" && request.method === "POST") {
        const body = (await request.json()) as { device_code?: string; device_name?: string };
        if (typeof body.device_code !== "string") return json({ error: "invalid_request" }, 400);

        const ghRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            device_code: body.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        const data = (await ghRes.json()) as { access_token?: string; error?: string };
        if (!data.access_token) return json(data, 400);

        const userRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${data.access_token}`, "User-Agent": "xtctx-cloud" },
        });
        const ghUser = (await userRes.json()) as { id?: number; login?: string; name?: string };
        if (!userRes.ok || typeof ghUser.id !== "number" || !ghUser.login) {
          return json({ error: "github_user_unavailable" }, 502);
        }

        const userId = `github:${ghUser.id}`;
        await upsertUser(env, userId, ghUser.login);
        const token = await createJwt(
          {
            sub: userId,
            username: ghUser.login,
            device_id: body.device_name || "default",
            ver: await getTokenVersion(env, userId),
          },
          env.JWT_SECRET,
        );
        return json({ token, user: { id: userId, username: ghUser.login, name: ghUser.name } });
      }

      const user = await authenticateRequest(request, env);
      if (!user) {
        return json({ error: "unauthorized" }, 401, {
          "WWW-Authenticate": 'Bearer realm="xtctx-cloud", error="invalid_token"',
        });
      }

      // Sign out everywhere: tokens carry the user's version, and this moves it.
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        await bumpTokenVersion(env, user.userId);
        return json({ success: true });
      }

      // Delete everything held for this user, then their account row, which
      // also ends every token they hold.
      if (url.pathname === "/api/me" && request.method === "DELETE") {
        await deleteUserData(env, user.userId);
        return json({ success: true });
      }

      if (url.pathname === "/api/stream" && request.method === "POST") {
        const deltas = parseTurnDeltas(await request.json());
        if (!deltas) return json({ error: "invalid_request" }, 400);
        return json(await ingestTurnDelta(env, user, deltas));
      }

      // Modern MCP endpoint (stateless, 2026-07-28 spec)
      if (url.pathname === "/mcp" && request.method === "POST") {
        const payload = await processJsonRpc(env, user, (await request.json()) as Record<string, unknown>);
        if (!payload) return new Response(null, { status: 204, headers: cors });
        return json(payload);
      }

      // Baseline MCP endpoint (SSE stream, 2024-11-05 spec). The stream is held
      // in a Durable Object so /message reaches it from any isolate.
      if (url.pathname === "/sse" && request.method === "GET") {
        const sessionId = crypto.randomUUID();
        const stub = env.SSE.get(env.SSE.idFromName(sessionId));
        const stream = await stub.fetch("https://sse/connect", {
          method: "POST",
          body: JSON.stringify({ userId: user.userId, endpoint: `${url.origin}/message?sessionId=${sessionId}` }),
        });
        return new Response(stream.body, {
          headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      if (url.pathname === "/message" && request.method === "POST") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        if (!SESSION_ID.test(sessionId)) return json({ error: "session_not_found" }, 404);

        const payload = await processJsonRpc(env, user, (await request.json()) as Record<string, unknown>);
        if (payload) {
          const stub = env.SSE.get(env.SSE.idFromName(sessionId));
          const sent = await stub.fetch("https://sse/send", {
            method: "POST",
            body: JSON.stringify({ userId: user.userId, payload }),
          });
          if (!sent.ok) return json({ error: "session_not_found" }, 404);
        }
        return json({ status: "accepted" }, 202);
      }

      return json({ error: "not_found" }, 404);
    } catch (err: unknown) {
      // The detail is for whoever reads the Worker's logs, not for the caller.
      console.error("unhandled error", err);
      return json({ error: "internal_error" }, 500);
    }
  },
};
