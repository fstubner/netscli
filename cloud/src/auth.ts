import type { Env, AuthUser } from "./types.js";
import { SCOPE_ACCOUNT_DELETE, SCOPE_READ, SCOPE_SYNC_WRITE } from "./types.js";
import { getAccountState } from "./db.js";

/** A CLI login lasts a month. Revocation (below) is what ends one sooner. */
export const CLI_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
/** A read-only token for pasting into an MCP client config. */
export const READ_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;

/** What `xtctx login` gets: everything the CLI does. */
export const CLI_SCOPES = [SCOPE_READ, SCOPE_SYNC_WRITE, SCOPE_ACCOUNT_DELETE];

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(text: string): Uint8Array {
  let base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** The canonical MCP resource: what OAuth tokens and pasted tokens are bound to. */
export function mcpResource(env: Env): string {
  return `${publicOrigin(env)}/mcp`;
}

/** The audience of tokens accepted by `/api/*`; only the CLI's own tokens carry it. */
export function apiAudience(env: Env): string {
  return `${publicOrigin(env)}/api`;
}

export function publicOrigin(env: Env): string {
  return new URL(env.PUBLIC_URL).origin;
}

/**
 * Mint an HMAC-SHA256 JWT using standard Web Crypto API.
 */
export async function createJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = CLI_TOKEN_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, exp: now + ttlSeconds, iat: now })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Mint a token for the CLI or for pasting, bound to this deployment's audiences. */
export async function mintToken(
  env: Env,
  claims: { userId: string; username: string; deviceId?: string; epoch: number; scopes: string[] },
  ttlSeconds: number,
): Promise<string> {
  const audiences = [mcpResource(env)];
  if (claims.scopes.includes(SCOPE_SYNC_WRITE) || claims.scopes.includes(SCOPE_ACCOUNT_DELETE)) {
    audiences.push(apiAudience(env));
  }
  return createJwt(
    {
      iss: publicOrigin(env),
      aud: audiences,
      sub: claims.userId,
      username: claims.username,
      device_id: claims.deviceId,
      ver: claims.epoch,
      scope: claims.scopes.join(" "),
    },
    env.JWT_SECRET!,
    ttlSeconds,
  );
}

export interface VerifiedToken extends AuthUser {
  epoch: number;
  scopes: string[];
  audiences: string[];
}

/**
 * Check a token's signature and expiry. Says nothing about revocation; that
 * needs the database, see `authenticateToken`.
 */
export async function verifyJwt(token: string, secret: string): Promise<VerifiedToken | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;

    if (JSON.parse(new TextDecoder().decode(fromBase64Url(header))).alg !== "HS256") return null;

    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, "verify"),
      fromBase64Url(signature),
      encoder.encode(`${header}.${body}`),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    // Tokens from before scopes existed carry neither of these and are
    // refused: their holders sign in again.
    if (typeof payload.scope !== "string" || !Array.isArray(payload.aud)) return null;
    if (typeof payload.ver !== "number") return null;

    return {
      userId: payload.sub,
      username: String(payload.username ?? ""),
      deviceId: typeof payload.device_id === "string" ? payload.device_id : undefined,
      epoch: payload.ver,
      scopes: payload.scope.split(" ").filter(Boolean),
      audiences: payload.aud.filter((a: unknown): a is string => typeof a === "string"),
    };
  } catch {
    return null;
  }
}

/** The GitHub ids allowed to sign in. Empty means nobody. */
export function allowedGithubIds(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_GITHUB_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  );
}

export function isAllowedUser(env: Env, userId: string): boolean {
  const match = /^github:(\d+)$/.exec(userId);
  return match !== null && allowedGithubIds(env).has(match[1]);
}

/**
 * Whether an account may still use a token minted at `epoch`: the account
 * exists, the epoch has not moved since (logout and delete-my-data move it),
 * and, unless `ignoreAllowlist`, its GitHub id is still on the allowlist.
 * Removing someone from ALLOWED_GITHUB_IDS ends their access at once; they
 * keep the ability to sign out and delete their data.
 */
export async function isAccountCurrent(
  env: Env,
  userId: string,
  epoch: number,
  options: { ignoreAllowlist?: boolean } = {},
): Promise<boolean> {
  if (!options.ignoreAllowlist && !isAllowedUser(env, userId)) return false;
  const state = await getAccountState(env, userId);
  return state.exists && state.epoch === epoch;
}

/**
 * Authenticate one of this server's own JWTs (the CLI's, or a pasted read
 * token) from the Authorization header, and only from there: a token in the
 * URL ends up in access logs and browser history.
 *
 * The token must name `audience`, and its account must be current; see
 * `isAccountCurrent`. Scope checks are the caller's.
 */
export async function authenticateToken(
  request: Request,
  env: Env,
  audience: string,
  options: { ignoreAllowlist?: boolean } = {},
): Promise<VerifiedToken | null> {
  if (!env.JWT_SECRET) return null;
  const header = request.headers.get("Authorization");
  const match = header ? /^Bearer[\t ]+(\S+)$/i.exec(header) : null;
  if (!match) return null;
  return verifyBearer(match[1], env, audience, options);
}

export async function verifyBearer(
  token: string,
  env: Env,
  audience: string,
  options: { ignoreAllowlist?: boolean } = {},
): Promise<VerifiedToken | null> {
  if (!env.JWT_SECRET) return null;
  const verified = await verifyJwt(token, env.JWT_SECRET);
  if (!verified || !verified.audiences.includes(audience)) return null;
  if (!(await isAccountCurrent(env, verified.userId, verified.epoch, options))) return null;
  return verified;
}

/**
 * RFC 6750 challenge for the routes this file guards. The MCP ones (`/sse`,
 * `/message`) point at the protected-resource metadata so a client can find
 * the authorization server; `/api/*` has no OAuth resource of its own.
 */
export function bearerChallenge(
  env: Env,
  options: { mcp?: boolean; error?: "invalid_token" | "insufficient_scope"; scope?: string[] } = {},
): string {
  const parts = [`Bearer realm="xtctx-cloud"`];
  if (options.mcp) parts.push(`resource_metadata="${publicOrigin(env)}/.well-known/oauth-protected-resource/mcp"`);
  if (options.error) parts.push(`error="${options.error}"`);
  if (options.scope?.length) parts.push(`scope="${options.scope.join(" ")}"`);
  return parts.join(", ");
}
