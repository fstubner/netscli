import type { Env, AuthUser } from "./types.js";

const DEFAULT_JWT_SECRET = "xtctx-cloud-default-secret-change-in-production";

/**
 * Mint an HMAC-SHA256 JWT using standard Web Crypto API.
 */
export async function createJwt(payload: Record<string, unknown>, secretStr: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90; // 90 days validity
  const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };
  const encodedPayload = btoa(JSON.stringify(fullPayload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const dataToSign = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signatureBuffer = await crypto.subtle.sign("HMAC", secretKey, dataToSign);
  
  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = "";
  for (let i = 0; i < signatureBytes.length; i++) {
    binary += String.fromCharCode(signatureBytes[i]);
  }
  const encodedSignature = btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verify an HMAC-SHA256 JWT using standard Web Crypto API.
 */
export async function verifyJwt(token: string, secretStr: string): Promise<AuthUser | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const encoder = new TextEncoder();

    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secretStr),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Decode signature from base64url
    let base64 = encodedSignature.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = atob(base64);
    const signatureBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      signatureBytes[i] = binary.charCodeAt(i);
    }

    const dataToVerify = encoder.encode(`${encodedHeader}.${encodedPayload}`);
    const isValid = await crypto.subtle.verify("HMAC", secretKey, signatureBytes, dataToVerify);
    if (!isValid) return null;

    // Decode payload
    let payloadBase64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    while (payloadBase64.length % 4) payloadBase64 += "=";
    const payload = JSON.parse(atob(payloadBase64));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    return {
      userId: payload.sub,
      username: payload.username,
      deviceId: payload.device_id,
    };
  } catch {
    return null;
  }
}

/**
 * Extract and authenticate user from request Authorization header or query param.
 */
export async function authenticateRequest(request: Request, env: Env): Promise<AuthUser | null> {
  const authHeader = request.headers.get("Authorization");
  const secret = env.JWT_SECRET || DEFAULT_JWT_SECRET;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return await verifyJwt(token, secret);
  }

  // Also support token query param for SSE transports that cannot set custom headers
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");
  if (tokenParam) {
    return await verifyJwt(tokenParam, secret);
  }

  return null;
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
