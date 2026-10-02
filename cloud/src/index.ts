import { OAuthError, OAuthProvider, insufficientScope } from "@cloudflare/workers-oauth-provider";
import type { Env, AuthUser } from "./types.js";
import { SCOPE_READ } from "./types.js";
import { isAccountCurrent, mcpResource, publicOrigin, verifyBearer } from "./auth.js";
import { MAX_MCP_BODY_BYTES, allowedOrigins, handleApp, readBodyCapped } from "./app.js";
import { handleMcpPost, LEGACY_VERSIONS, MODERN_VERSIONS } from "./mcp.js";
import type { OAuthGrantProps } from "./oauth.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export { SseSession } from "./sse-session.js";

/** OAuth access tokens are short-lived; the refresh token carries the grant. */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

interface CliTokenProps {
  kind: "cli";
  userId: string;
  username: string;
  deviceId?: string;
  epoch: number;
  scopes: string[];
}

type McpProps = OAuthGrantProps | CliTokenProps;

/**
 * `POST /mcp`, reached only with a token the provider accepted for the MCP
 * resource: one it issued through `/authorize`, or one of this server's own
 * (see `resolveExternalToken`).
 */
const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { props, auth } = ctx as unknown as {
      props: McpProps;
      auth: { scope: string[]; audience: string; token: string };
    };
    const scopes = props.kind === "oauth" ? auth.scope : props.scopes;
    // The provider checked the token; whether the account behind it still may
    // read is ours: logout and delete-my-data move the epoch, and the
    // allowlist can drop someone.
    if (props.kind === "oauth" && !(await isAccountCurrent(env, props.userId, props.epoch))) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${publicOrigin(env)}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
        },
      });
    }
    if (!scopes.includes(SCOPE_READ)) return insufficientScope(auth as never, [SCOPE_READ]);

    const text = await readBodyCapped(request, MAX_MCP_BODY_BYTES);
    if (text === null) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
    }
    const user: AuthUser = { userId: props.userId, username: props.username };
    return handleMcpPost(env, user, request, text);
  },
};

const providers = new Map<string, OAuthProvider<Env>>();

/** One provider per public origin: its endpoints and resource are absolute URLs. */
function providerFor(env: Env): OAuthProvider<Env> {
  const origin = publicOrigin(env);
  let provider = providers.get(origin);
  if (provider) return provider;

  provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpApiHandler as never,
    defaultHandler: { fetch: (request: Request, env: Env) => handleApp(request, env) } as never,
    authorizeEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/oauth/token`,
    // Deprecated by MCP 2026-07-28 in favour of Client ID Metadata Documents
    // (enabled below), and kept because clients in use today still register
    // this way.
    clientRegistrationEndpoint: `${origin}/oauth/register`,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [SCOPE_READ],
    requiredScopes: [SCOPE_READ],
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
    resourceMetadata: {
      resource: mcpResource(env),
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource_name: "xtctx cloud",
    },
    // This server's own JWTs at /mcp: the CLI's login, or a pasted read
    // token. Both name the MCP resource in `aud`, so this is the same
    // audience check the provider applies to its own tokens.
    resolveExternalToken: async ({ token, env }) => {
      const verified = await verifyBearer(token, env, mcpResource(env));
      if (!verified) return null;
      const props: CliTokenProps = {
        kind: "cli",
        userId: verified.userId,
        username: verified.username,
        deviceId: verified.deviceId,
        epoch: verified.epoch,
        scopes: verified.scopes,
      };
      return { props, audience: mcpResource(env) };
    },
    // A refresh after logout or delete-my-data, or after the account left the
    // allowlist, ends the grant instead of minting a token that /mcp refuses.
    tokenExchangeCallback: async ({ grantType, props, env }) => {
      if (grantType !== "refresh_token") return;
      const p = props as OAuthGrantProps;
      if (!(await isAccountCurrent(env, p.userId, p.epoch))) {
        throw new OAuthError("invalid_grant", { description: "This sign-in has been revoked" });
      }
    },
    onError: ({ code, status, internal }) => {
      if (status >= 500) console.error(JSON.stringify({ event: "oauth_error", code, status, internal }));
    },
  });
  providers.set(origin, provider);
  return provider;
}

function withServerHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Xtctx-Server-Version", SERVER_VERSION);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const PROTECTED_RESOURCE_ROOT = "/.well-known/oauth-protected-resource";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

    try {
      const url = new URL(request.url);

      if (url.pathname === "/" || url.pathname === "/health") {
        return withServerHeaders(
          json({
            status: "ok",
            service: SERVER_NAME,
            version: SERVER_VERSION,
            mcp: {
              supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
              endpoints: { streamableHttp: "/mcp", sse: "/sse" },
            },
          }),
        );
      }

      // Without a signing secret nothing below can be trusted, so none of it
      // runs. There used to be a built-in default, which made every token
      // forgeable on a deployment that forgot to set one.
      if (!env.JWT_SECRET || !env.PUBLIC_URL) {
        console.error(JSON.stringify({ event: "misconfigured", jwtSecret: !!env.JWT_SECRET, publicUrl: !!env.PUBLIC_URL }));
        return withServerHeaders(json({ error: "server_misconfigured" }, 500));
      }

      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
        // Streamable HTTP: a present Origin that is not ours is refused
        // (DNS rebinding). CLI and agent clients send none.
        const origin = request.headers.get("Origin");
        if (origin && origin !== publicOrigin(env) && !allowedOrigins(env).includes(origin)) {
          return withServerHeaders(json({ jsonrpc: "2.0", error: { code: -32600, message: "Origin not allowed" } }, 403));
        }
        // No GET stream and no sessions to DELETE: both eras get 405.
        if (request.method !== "POST" && request.method !== "OPTIONS") {
          return withServerHeaders(new Response(null, { status: 405, headers: { Allow: "POST" } }));
        }
      }

      // RFC 9728 puts this resource's metadata at the /mcp form; some clients
      // (Claude Code among them) also try the root form, so it answers too,
      // with the same document.
      if (url.pathname === PROTECTED_RESOURCE_ROOT && (request.method === "GET" || request.method === "HEAD")) {
        const aliased = new Request(`${publicOrigin(env)}${PROTECTED_RESOURCE_ROOT}/mcp`, { method: request.method });
        return withServerHeaders(await providerFor(env).fetch(aliased, env, ctx));
      }

      return withServerHeaders(await providerFor(env).fetch(request, env, ctx));
    } catch (err: unknown) {
      // The detail is for whoever reads the Worker's logs, not for the caller.
      console.error(JSON.stringify({ event: "unhandled_error", error: err instanceof Error ? err.stack ?? err.message : String(err) }));
      return withServerHeaders(json({ error: "internal_error" }, 500));
    }
  },
};
