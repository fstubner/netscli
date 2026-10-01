import type { Env, AuthUser } from "./types.js";
import { getTokenVersion } from "./db.js";

/** Tokens last a month. Revocation (below) is what ends one sooner. */
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

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

/**
 * Mint an HMAC-SHA256 JWT using standard Web Crypto API.
 */
export async function createJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = TOKEN_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, exp: now + ttlSeconds, iat: now })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${toBase64Url(new Uint8Array(signature))}`;
}

interface VerifiedToken extends AuthUser {
  tokenVersion: number;
}

/**
 * Check a token's signature and expiry. Says nothing about revocation; that
 * needs the database, see `authenticateRequest`.
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
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      userId: payload.sub,
      username: String(payload.username ?? ""),
      deviceId: payload.device_id,
      tokenVersion: Number(payload.ver ?? -1),
    };
  } catch {
    return null;
  }
}

/**
 * Authenticate from the Authorization header, and only from there: a token in
 * the URL ends up in access logs and browser history.
 *
 * A valid signature is not enough. The user must still exist and the token's
 * version must match the user's current one, which is how logout and
 * delete-my-data take effect on a token that has not expired. Fails closed
 * when no secret is configured; the caller reports that as a server fault
 * before getting here.
 */
export async function authenticateRequest(request: Request, env: Env): Promise<AuthUser | null> {
  if (!env.JWT_SECRET) return null;

  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const verified = await verifyJwt(header.slice(7).trim(), env.JWT_SECRET);
  if (!verified) return null;

  const current = await getTokenVersion(env, verified.userId);
  if (current === null || current !== verified.tokenVersion) return null;

  return { userId: verified.userId, username: verified.username, deviceId: verified.deviceId };
}

/**
 * Return RFC 9728 OAuth Protected Resource Metadata for native MCP clients.
 */
export function getProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: baseUrl,
    authorization_servers: ["https://github.com/login/oauth"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read:user", "user:email"],
  };
}
