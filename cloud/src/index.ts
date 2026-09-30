import type { Env } from "./types.js";
import { authenticateRequest, getProtectedResourceMetadata, createJwt } from "./auth.js";
import { ingestTurnDelta } from "./db.js";
import { processJsonRpc } from "./mcp.js";

// Active SSE client streams mapped by sessionId
const sseStreams = new Map<string, { writer: WritableStreamDefaultWriter<Uint8Array>; user: any }>();

function corsHeaders(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
    ...extra,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // 1. Health check & status
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "xtctx-cloud",
        version: "0.22.0",
        mcp: {
          supportedVersions: ["2026-07-28", "2024-11-05"],
          endpoints: {
            stateless: "/mcp",
            sse: "/sse"
          }
        }
      }, null, 2), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    // 2. OAuth Discovery (RFC 9728) for MCP Clients
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return new Response(JSON.stringify(getProtectedResourceMetadata(url.origin), null, 2), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    // 3. GitHub Device Authorization Flow
    if (url.pathname === "/auth/device/code" && request.method === "POST") {
      const clientId = env.GITHUB_CLIENT_ID;
      const ghRes = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          scope: "read:user user:email",
        }),
      });
      const data = await ghRes.json();
      return new Response(JSON.stringify(data), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    if (url.pathname === "/auth/device/poll" && request.method === "POST") {
      const body = await request.json() as { device_code: string; device_name?: string };
      const clientId = env.GITHUB_CLIENT_ID;

      const ghRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: body.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await ghRes.json() as { access_token?: string; error?: string };
      if (!data.access_token) {
        return new Response(JSON.stringify(data), {
          status: 400,
          headers: corsHeaders({ "Content-Type": "application/json" })
        });
      }

      // Fetch user profile from GitHub
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${data.access_token}`,
          "User-Agent": "xtctx-cloud",
        },
      });
      const ghUser = await userRes.json() as { id: number; login: string; name?: string; email?: string };

      // Mint xtctx JWT
      const secret = env.JWT_SECRET || "xtctx-cloud-default-secret-change-in-production";
      const token = await createJwt({
        sub: `github:${ghUser.id}`,
        username: ghUser.login,
        device_id: body.device_name || "default",
      }, secret);

      return new Response(JSON.stringify({
        token,
        user: {
          id: `github:${ghUser.id}`,
          username: ghUser.login,
          name: ghUser.name,
        }
      }), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    // 4. Authenticate all protected API & MCP routes
    const user = await authenticateRequest(request, env);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing token" }), {
        status: 401,
        headers: corsHeaders({
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="xtctx-cloud", error="invalid_token"'
        })
      });
    }

    // 5. Real-Time Stream Ingestion (Called by local xtctx daemon)
    if (url.pathname === "/api/stream" && request.method === "POST") {
      const delta = await request.json() as any;
      const result = await ingestTurnDelta(env, user, delta);
      return new Response(JSON.stringify(result), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    // 6. Modern MCP Endpoint (Stateless, 2026-07-28 Spec)
    if (url.pathname === "/mcp" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const responsePayload = await processJsonRpc(env, user, body);
      if (!responsePayload) {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      return new Response(JSON.stringify(responsePayload), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    // 7. Baseline MCP Endpoint (SSE Stream, 2024-11-05 Spec)
    if (url.pathname === "/sse" && request.method === "GET") {
      const sessionId = crypto.randomUUID();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      sseStreams.set(sessionId, { writer, user });

      // Send endpoint event as required by baseline MCP SSE spec
      const endpointUrl = `${url.origin}/message?sessionId=${sessionId}`;
      void writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));

      request.signal.addEventListener("abort", () => {
        sseStreams.delete(sessionId);
        void writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: corsHeaders({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        })
      });
    }

    // 8. Baseline MCP Message POST Endpoint
    if (url.pathname === "/message" && request.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !sseStreams.has(sessionId)) {
        return new Response("Session not found", { status: 404, headers: corsHeaders() });
      }

      const session = sseStreams.get(sessionId)!;
      const body = await request.json() as Record<string, unknown>;
      const responsePayload = await processJsonRpc(env, session.user, body);

      if (responsePayload) {
        const encoder = new TextEncoder();
        void session.writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`));
      }

      return new Response(JSON.stringify({ status: "accepted" }), {
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }
};
