/**
 * The browser sign-in MCP clients use, end to end against a stubbed GitHub:
 * discovery, client registration, /authorize with consent, GitHub's callback,
 * the token endpoint, and the resulting token at /mcp.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnv, PUBLIC_URL } from "./fake-env.js";
import { call, login, stubGitHub } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const REDIRECT = "http://127.0.0.1:33418/callback";
const RESOURCE = `${PUBLIC_URL}/mcp`;

/** Cookies set by one response, as a Cookie header for the next. */
class Jar {
  private cookies = new Map<string, string>();
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return res;
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function b64url(bytes: ArrayBuffer | Uint8Array) {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

async function register(env: unknown) {
  const res = await call(env, "/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Agent",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/**
 * Walk the browser through /authorize, consent and GitHub, as the GitHub user
 * `githubId`. Returns where the browser lands back at the client.
 */
async function authorize(env: unknown, clientId: string, githubId: number, options: { challenge?: string; method?: string; decision?: string } = {}) {
  const jar = new Jar();
  const { challenge } = options.challenge ? { challenge: options.challenge } : await pkce();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "client-state",
    scope: "read",
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: options.method ?? "S256",
  });
  const page = jar.take(await call(env, `/authorize?${params}`));
  if (page.status !== 200) return { landing: page.headers.get("Location"), page };
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1];

  const form = new URLSearchParams({ handle, decision: options.decision ?? "approve" });
  const approved = jar.take(
    await call(env, "/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
      body: form.toString(),
    }),
  );
  expect(approved.status).toBe(302);
  const toGithub = new URL(approved.headers.get("Location")!);
  if (toGithub.origin !== "https://github.com") return { landing: toGithub.toString(), html };

  const seen = stubGitHub(githubId, `user${githubId}`);
  const back = await call(env, `/oauth/github/callback?code=gh-code&state=${toGithub.searchParams.get("state")}`, {
    headers: { Cookie: jar.header() },
  });
  vi.unstubAllGlobals();
  expect(back.status).toBe(302);
  return { landing: back.headers.get("Location")!, html, toGithub, seen };
}

async function exchange(env: unknown, form: Record<string, string>) {
  const res = await call(env, "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function signIn(env: unknown, githubId = 1) {
  const clientId = await register(env);
  const { verifier, challenge } = await pkce();
  const { landing } = await authorize(env, clientId, githubId, { challenge });
  const code = new URL(landing!).searchParams.get("code")!;
  const tokens = await exchange(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  expect(tokens.status).toBe(200);
  return { clientId, ...tokens.body } as { clientId: string; access_token: string; refresh_token: string; scope: string; expires_in: number };
}

const statusCall = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "xtctx_cloud_status", arguments: {} } });

describe("discovery", () => {
  it("serves protected-resource metadata at the /mcp and root forms, unauthenticated, naming the MCP URL", async () => {
    const { env } = createEnv();
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await call(env, path);
      expect(res.status, path).toBe(200);
      const doc = (await res.json()) as Record<string, unknown>;
      expect(doc.resource).toBe(RESOURCE);
      expect(doc.authorization_servers).toEqual([PUBLIC_URL]);
      expect(doc.scopes_supported).toEqual(["read"]);
    }
  });

  it("serves authorization-server metadata with PKCE S256, CIMD and registration", async () => {
    const { env } = createEnv();
    const res = await call(env, "/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, any>;
    expect(doc.issuer).toBe(PUBLIC_URL);
    expect(doc.authorization_endpoint).toBe(`${PUBLIC_URL}/authorize`);
    expect(doc.token_endpoint).toBe(`${PUBLIC_URL}/oauth/token`);
    expect(doc.registration_endpoint).toBe(`${PUBLIC_URL}/oauth/register`);
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
    expect(doc.scopes_supported).toEqual(["read"]);
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe("authorize", () => {
  it("shows a consent page naming the client and where access goes, and sends the browser to GitHub with PKCE", async () => {
    const { env } = createEnv();
    const clientId = await register(env);
    const jar = new Jar();
    const { challenge } = await pkce();
    const page = jar.take(
      await call(env, `/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "s", resource: RESOURCE, code_challenge: challenge, code_challenge_method: "S256" })}`),
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("X-Frame-Options")).toBe("DENY");
    const html = await page.text();
    expect(html).toContain("Allow Test Agent to read your xtctx cloud?");
    expect(html).toContain("127.0.0.1");
    expect(html).toContain("app on your computer");

    const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
    const res = await call(env, "/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
      body: new URLSearchParams({ handle, decision: "approve" }).toString(),
    });
    const github = new URL(res.headers.get("Location")!);
    expect(github.origin + github.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(github.searchParams.get("client_id")).toBe("test-client");
    expect(github.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/oauth/github/callback`);
    expect(github.searchParams.get("code_challenge_method")).toBe("S256");
    expect(github.searchParams.get("state")).toBeTruthy();
  });

  it("escapes a hostile client name", async () => {
    const { env } = createEnv();
    const res = await call(env, "/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "<script>alert(1)</script>", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
    });
    const clientId = ((await res.json()) as { client_id: string }).client_id;
    const { challenge } = await pkce();
    const page = await call(env, `/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "s", code_challenge: challenge, code_challenge_method: "S256" })}`);
    const html = await page.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&#60;script&#62;");
  });

  it("requires PKCE with S256, even from a client that registered with a secret", async () => {
    const { env } = createEnv();
    const res = await call(env, "/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Confidential", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_post" }),
    });
    const clientId = ((await res.json()) as { client_id: string }).client_id;
    const page = await call(env, `/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "s" })}`);
    expect(page.status).toBe(302);
    const back = new URL(page.headers.get("Location")!);
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("state")).toBe("s");
  });

  it("sends a Deny back to the client as access_denied", async () => {
    const { env } = createEnv();
    const clientId = await register(env);
    const { landing } = await authorize(env, clientId, 1, { decision: "deny" });
    const back = new URL(landing!);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("iss")).toBe(PUBLIC_URL);
  });

  it("refuses a GitHub account that is not on the allowlist, without creating it", async () => {
    const { env, db } = createEnv({ ALLOWED_GITHUB_IDS: "1" });
    const clientId = await register(env);
    const { landing } = await authorize(env, clientId, 99);
    expect(new URL(landing!).searchParams.get("error")).toBe("access_denied");
    expect(db.prepare("SELECT count(*) n FROM users").get()).toEqual({ n: 0 });
  });

  it("answers 503 when browser sign-in is not configured", async () => {
    const { env } = createEnv({ GITHUB_CLIENT_SECRET: undefined });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call(env, "/authorize?client_id=x")).status).toBe(503);
  });
});

describe("tokens from the authorization flow", () => {
  it("are short-lived, scoped read, bound to /mcp, and work there", async () => {
    const { env } = createEnv();
    const tokens = await signIn(env);
    expect(tokens.scope).toBe("read");
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
    expect(tokens.refresh_token).toBeTruthy();

    const res = await call(env, "/mcp", { method: "POST", token: tokens.access_token, body: statusCall });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result.content[0].text).toContain("Nothing has been uploaded");
  });

  it("cannot upload, delete or mint tokens: those need the CLI's own login", async () => {
    const { env } = createEnv();
    const { access_token } = await signIn(env);
    expect((await call(env, "/api/stream", { method: "POST", token: access_token, body: "{}" })).status).toBe(401);
    expect((await call(env, "/api/me", { method: "DELETE", token: access_token })).status).toBe(401);
    expect((await call(env, "/api/tokens", { method: "POST", token: access_token })).status).toBe(401);
  });

  it("are not accepted at a different resource", async () => {
    const { env } = createEnv();
    const { access_token } = await signIn(env);
    const elsewhere = await call(env, "/mcp", { method: "POST", token: access_token, body: statusCall, base: "https://sync.test" });
    expect(elsewhere.status).toBe(401);
  });

  it("refresh, and stop working everywhere after the CLI logs out", async () => {
    const { env } = createEnv();
    const tokens = await signIn(env);
    const refreshed = await exchange(env, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId });
    expect(refreshed.status).toBe(200);

    const cli = await login(env, 1);
    expect((await call(env, "/auth/logout", { method: "POST", token: cli })).status).toBe(200);

    expect((await call(env, "/mcp", { method: "POST", token: refreshed.body.access_token, body: statusCall })).status).toBe(401);
    const again = await exchange(env, { grant_type: "refresh_token", refresh_token: refreshed.body.refresh_token, client_id: tokens.clientId });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
  });

  it("stop working after delete-my-data, even if the grant survived in KV", async () => {
    const { env, kv } = createEnv();
    const tokens = await signIn(env);
    const snapshot = new Map(kv.store);
    const cli = await login(env, 1);
    expect((await call(env, "/api/me", { method: "DELETE", token: cli })).status).toBe(200);
    // Put the grant and token records back, as if KV revocation had failed.
    for (const [k, v] of snapshot) kv.store.set(k, v);
    await login(env, 1); // the account exists again, with a newer epoch
    expect((await call(env, "/mcp", { method: "POST", token: tokens.access_token, body: statusCall })).status).toBe(401);
  });

  it("refuse a code exchanged without the right PKCE verifier", async () => {
    const { env } = createEnv();
    const clientId = await register(env);
    const { challenge } = await pkce();
    const { landing } = await authorize(env, clientId, 1, { challenge });
    const code = new URL(landing!).searchParams.get("code")!;
    const res = await exchange(env, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: "wrong".repeat(10), resource: RESOURCE });
    expect(res.status).toBe(400);
  });
});

describe("Client ID Metadata Documents", () => {
  it("is advertised when the runtime has global_fetch_strictly_public", async () => {
    vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
    const { env } = createEnv();
    const doc = (await (await call(env, "/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(doc.client_id_metadata_document_supported).toBe(true);
  });

  it("accepts a client identified by an HTTPS metadata URL and shows its domain", async () => {
    // What wrangler.toml's compatibility flag gives the Worker in production.
    vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
    const { env } = createEnv();
    const clientId = "https://client.example/oauth/metadata.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url instanceof Request ? url.url : url);
        if (u === clientId) {
          return Response.json(
            { client_id: clientId, client_name: "Example Agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
            { headers: { "Cache-Control": "max-age=60" } },
          );
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
    const { challenge } = await pkce();
    const page = await call(env, `/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "s", resource: RESOURCE, code_challenge: challenge, code_challenge_method: "S256" })}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Example Agent");
    expect(html).toContain("Published by <strong>client.example</strong>");
  });
});
