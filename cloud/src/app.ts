import type { Env, AuthUser } from "./types.js";
import { SCOPE_ACCOUNT_DELETE, SCOPE_READ, SCOPE_SYNC_WRITE } from "./types.js";
import {
  CLI_SCOPES,
  CLI_TOKEN_TTL_SECONDS,
  READ_TOKEN_TTL_SECONDS,
  apiAudience,
  authenticateToken,
  bearerChallenge,
  isAllowedUser,
  mcpResource,
  mintToken,
  type VerifiedToken,
} from "./auth.js";
import { LIMITS, bumpTokenEpoch, deleteUserData, ingestUpload, parseUpload, upsertUser } from "./db.js";
import { processMessage } from "./mcp.js";
import { GITHUB_CALLBACK_PATH, githubUser, handleAuthorize, handleGithubCallback, revokeOAuthGrants } from "./oauth.js";

const SESSION_ID = /^[0-9a-f-]{36}$/;
/** An MCP request is one small JSON-RPC message. */
export const MAX_MCP_BODY_BYTES = 256 * 1024;

/**
 * CORS is for browsers, and nothing here is called from one: the CLI and MCP
 * clients are not subject to it. So the default is no CORS headers at all,
 * and an origin gets them only by being listed in ALLOWED_ORIGINS.
 */
export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name";
  }
  return headers;
}

/**
 * Read a body without holding more than `max` bytes of it. Null when it is
 * larger, whether or not Content-Length said so.
 */
export async function readBodyCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(request: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  const text = await readBodyCapped(request, max);
  if (text === null) return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Everything that is not `/mcp` or one of the provider's own OAuth endpoints. */
export async function handleApp(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/authorize") return handleAuthorize(request, env);
  if (url.pathname === GITHUB_CALLBACK_PATH && request.method === "GET") return handleGithubCallback(request, env);

  if (url.pathname === "/auth/device/code" && request.method === "POST") {
    const ghRes = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, scope: "read:user" }),
    }).catch(() => null);
    if (!ghRes) return json({ error: "github_unavailable" }, 502);
    return json(await ghRes.json().catch(() => ({ error: "github_unavailable" })), ghRes.ok ? 200 : 502);
  }

  if (url.pathname === "/auth/device/poll" && request.method === "POST") {
    const body = await readJson(request, 4096);
    if (!body.ok) return json({ error: "invalid_request" }, 400);
    const deviceCode = (body.value as { device_code?: unknown } | null)?.device_code;
    if (typeof deviceCode !== "string" || !deviceCode) return json({ error: "invalid_request" }, 400);

    const ghRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }).catch(() => null);
    if (!ghRes) return json({ error: "github_unavailable" }, 502);
    const data = (await ghRes.json().catch(() => ({}))) as { access_token?: string; error?: string; interval?: number };
    // authorization_pending, slow_down, expired_token, access_denied: the
    // client acts on these, so they pass through as GitHub named them.
    if (!data.access_token) {
      return json({ error: data.error ?? "github_error", ...(data.interval ? { interval: data.interval } : {}) }, 400);
    }

    const ghUser = await githubUser(data.access_token).catch(() => null);
    if (!ghUser) return json({ error: "github_user_unavailable" }, 502);

    const userId = `github:${ghUser.id}`;
    // Before anything is written for this account: ALLOWED_GITHUB_IDS, and
    // nobody when it is empty.
    if (!isAllowedUser(env, userId)) {
      return json({ error: "not_allowed", detail: "This GitHub account is not on this server's allowlist." }, 403);
    }

    const epoch = await upsertUser(env, userId, ghUser.login);
    const token = await mintToken(
      env,
      { userId, username: ghUser.login, epoch, scopes: CLI_SCOPES },
      CLI_TOKEN_TTL_SECONDS,
    );
    return json({ token, scope: CLI_SCOPES.join(" "), user: { id: userId, username: ghUser.login } });
  }

  // From here every route needs a token.
  const requireToken = async (
    audience: string,
    scope: string,
    options: { mcp?: boolean; ignoreAllowlist?: boolean } = {},
  ): Promise<VerifiedToken | Response> => {
    const verified = await authenticateToken(request, env, audience, options);
    if (!verified) {
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": bearerChallenge(env, { mcp: options.mcp, error: "invalid_token" }),
      });
    }
    if (!verified.scopes.includes(scope)) {
      return json({ error: "insufficient_scope", scope }, 403, {
        "WWW-Authenticate": bearerChallenge(env, { mcp: options.mcp, error: "insufficient_scope", scope: [scope] }),
      });
    }
    return verified;
  };
  const asUser = (v: VerifiedToken): AuthUser => ({ userId: v.userId, username: v.username, deviceId: v.deviceId });

  // Sign out everywhere: every token carries the user's epoch, and this moves it.
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    const auth = await requireToken(apiAudience(env), SCOPE_READ, { ignoreAllowlist: true });
    if (auth instanceof Response) return auth;
    await bumpTokenEpoch(env, auth.userId);
    await revokeOAuthGrants(env, auth.userId);
    return json({ success: true });
  }

  // Delete everything held for this user and end every token they hold.
  if (url.pathname === "/api/me" && request.method === "DELETE") {
    const auth = await requireToken(apiAudience(env), SCOPE_ACCOUNT_DELETE, { ignoreAllowlist: true });
    if (auth instanceof Response) return auth;
    await deleteUserData(env, auth.userId);
    await revokeOAuthGrants(env, auth.userId);
    return json({ success: true });
  }

  // A read-only token to paste into an MCP client that cannot do the OAuth sign-in.
  if (url.pathname === "/api/tokens" && request.method === "POST") {
    const auth = await requireToken(apiAudience(env), SCOPE_SYNC_WRITE);
    if (auth instanceof Response) return auth;
    const token = await mintToken(
      env,
      { userId: auth.userId, username: auth.username, epoch: auth.epoch, scopes: [SCOPE_READ] },
      READ_TOKEN_TTL_SECONDS,
    );
    return json({
      token,
      scope: SCOPE_READ,
      mcp_url: mcpResource(env),
      expires_at: new Date(Date.now() + READ_TOKEN_TTL_SECONDS * 1000).toISOString(),
    });
  }

  if (url.pathname === "/api/stream" && request.method === "POST") {
    const auth = await requireToken(apiAudience(env), SCOPE_SYNC_WRITE);
    if (auth instanceof Response) return auth;
    const text = await readBodyCapped(request, LIMITS.maxBodyBytes);
    if (text === null) return json({ error: "body_too_large", limit: LIMITS.maxBodyBytes }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: "invalid_request", detail: "body is not JSON" }, 400);
    }
    const parsed = parseUpload(raw);
    if (!parsed.ok) return json(parsed.error, parsed.status);
    const messages = parsed.body.sessions.reduce((n, s) => n + s.messages.length, 0);
    try {
      return json(await ingestUpload(env, asUser(auth), parsed.body, request.headers.get("X-Xtctx-Client")));
    } catch (err) {
      // Sizes and counts, never content.
      console.error(
        JSON.stringify({
          event: "ingest_failed",
          userId: auth.userId,
          bytes: text.length,
          sessions: parsed.body.sessions.length,
          messages,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return json({ error: "internal_error" }, 500);
    }
  }

  // Baseline MCP transport (SSE stream, 2024-11-05). The stream is held in a
  // Durable Object so /message reaches it from any isolate. Takes this
  // server's own tokens (the CLI's, or a pasted read token): OAuth clients use
  // /mcp.
  if (url.pathname === "/sse" && request.method === "GET") {
    const auth = await requireToken(mcpResource(env), SCOPE_READ, { mcp: true });
    if (auth instanceof Response) return auth;
    const sessionId = crypto.randomUUID();
    const stub = env.SSE.get(env.SSE.idFromName(sessionId));
    const stream = await stub.fetch("https://sse/connect", {
      method: "POST",
      body: JSON.stringify({ userId: auth.userId, endpoint: `${url.origin}/message?sessionId=${sessionId}` }),
    });
    return new Response(stream.body, {
      headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    });
  }

  if (url.pathname === "/message" && request.method === "POST") {
    const auth = await requireToken(mcpResource(env), SCOPE_READ, { mcp: true });
    if (auth instanceof Response) return auth;
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!SESSION_ID.test(sessionId)) return json({ error: "session_not_found" }, 404);

    const body = await readJson(request, MAX_MCP_BODY_BYTES);
    if (!body.ok) {
      return json({ jsonrpc: "2.0", id: null, error: { code: body.status === 413 ? -32600 : -32700, message: "Parse error" } }, body.status);
    }
    const outcome = await processMessage(env, asUser(auth), body.value);
    if (outcome.body) {
      const stub = env.SSE.get(env.SSE.idFromName(sessionId));
      const sent = await stub.fetch("https://sse/send", {
        method: "POST",
        body: JSON.stringify({ userId: auth.userId, payload: outcome.body }),
      });
      if (!sent.ok) return json({ error: "session_not_found" }, 404);
    }
    return json({ status: "accepted" }, 202);
  }

  return json({ error: "not_found" }, 404);
}
